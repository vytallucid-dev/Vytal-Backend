// ─────────────────────────────────────────────────────────────
// PURE derivation for NbfcFundamental (annual) — deriveFromRow bridge.
//
// VERBATIM EXTRACTION of the inline block in ingest-nbfc-annual.ts (CN-8: no
// math change). The single prior-row fetch stays in the ingester; this module
// is pure and takes the prior bundle.
//
// 12 derived columns:
//   • NON-prior (denom-aware gated): costToIncomeRatio, capitalToAssetsRatio,
//     borrowingsToEquity, netWorth, bookValuePerShare.
//   • PRIOR-dependent (exempt, determinism-checked): nim, creditCostPct, spread
//     (avg loans / avg borrowings), roe (avg equity), aumGrowthYoy,
//     revenueGrowthYoy, patGrowthYoy.
//
// FLAGS (CN-8, preserved unchanged, not fixed):
//   • costToIncomeRatio is null-gated on `nii !== null` even though nii is not
//     in its formula (opEx / (totalIncome − financeCosts)). Quirk preserved.
//   • The prior select fetched financeCosts + interestIncome but never used
//     them — dropped from the bundle (no output effect).
//
// ── ★ FIXED, NOT A CN-8 QUIRK — 2026-08-11, nbfcFundamental.upsert numeric
//    overflow on TATAINVEST FY25 annual ─────────────────────────────────────
// `nim = nii / avgLoans` was gated only on `avgLoans !== 0` (exact zero). For
// an NBFC-taxonomy filer that isn't actually a lender — TATAINVEST is an
// investment-holding company; its `loans` line is ₹0.04cr against ₹41.96cr of
// interestIncome (income from investments/deposits, not lending) — avgLoans is
// non-zero but not a real loan book, and nii/avgLoans came out to 1045 (i.e. a
// "NIM" of 104,500%), which overflows nim's Decimal(8,6) column (max
// ±99.999999). costToIncomeRatio/capitalToAssetsRatio/roe/etc were all fine;
// this is not a case of the column being too tight for a legitimate value — no
// real annual NIM is ever within orders of magnitude of 100%, let alone
// 104,500%. WIDENING nim's column would have stored the artifact more
// precisely, not fixed it.
//
// SAME CUT AS insight/quarter-brief/margins.ts's MEANINGFUL_MARGIN_MAX_ABS: a
// scale-free bound on what the RATIO can mean, not a floor on avgLoans' size
// (which would incorrectly suppress a genuinely small, real lender's
// legitimate NIM). No real lender earns back more than its own average book
// in interest within a year, so |ratio| > 1 means avgLoans isn't a real loan
// book for this row, not that the company had an extreme year. Confirmed
// against ALREADY-STORED rows for other AMC-shaped "NBFC" filers — ICICIAMC,
// NAM-INDIA (Nippon India AMC), UTIAMC all had `nim` silently stored between
// -7368% and +751% (small enough vs their own `loans` line to fit Decimal(8,6)
// and so never threw), and IRFC (a real lender, but most of its earning assets
// sit outside the `loans` tag) had nim=-247%/spread=144%. All are the same
// shape: avgLoans doesn't represent the entity's true interest-earning base.
// Applied to nim, creditCostPct, and spread's two components (yieldOnAdvances,
// costOfFunds) — the four ratios that divide an annual interest-type flow by
// an average balance-sheet stock. costToIncomeRatio/capitalToAssetsRatio/
// borrowingsToEquity/roe divide two same-flavour figures (flow/flow or
// stock/stock) where multiples beyond 100% are legitimate, so they are NOT
// gated here.
//
// ── ★ SECOND FIX, SAME SHAPE — 2026-08-11, bookValuePerShare implausible
//    (₹7.95 lakh/share) on MOTILALOFS FY26 standalone ──────────────────────
// Root cause traced to the SOURCE FILING, not our extraction: the raw XBRL
// literally carries
//   <in-capmkt:FaceValueOfEquityShareCapital contextRef="OneD" decimals="INF"
//     unitRef="INRPerShare">6018.6</in-capmkt:FaceValueOfEquityShareCapital>
// — filed by MOTILALOFS/its agent, not a parse or unit-scaling bug (unitRef
// is "INRPerShare", correctly left unscaled by extractNumber; every OTHER
// MOTILALOFS fiscal year, both bases, has faceValueShare=1, and the implied
// share count from THIS row — paidUpEquityCapital(60.19cr) / 6018.6 = ~100,000
// shares — is impossible for a company with a ₹60cr+ paid-up capital.
// bookValuePerShare inherited the corruption via `netWorth / (paidUp/faceValue)`.
//
// SAME CUT AS derive-indas-annual.ts's plausibleFaceValue/boundDerived (Indian
// equity face values are 1/2/5/10, occasionally to 100; PLAUSIBLE_FACE_VALUE_MAX
// = 1000 there). REUSED here rather than re-implemented — see the import above —
// so NBFC/banking/LI/GI don't each grow their own copy of the same bound. The
// caller (ingest-nbfc-annual.ts / fill/re-derive.ts) is responsible for calling
// plausibleFaceValue() on the raw parsed/stored value and passing the result as
// `faceValueShareSane`, exactly as the Ind-AS path already does — this module
// stays pure and never reads the unsanitised field. bookValuePerShare is also
// wrapped in boundDerived so a DIFFERENT corrupt input (not just face value)
// nulls the one display column instead of failing the whole upsert.
//
// ── ★ THIRD, RELATED FIX — same sweep, a face value that looks FINE ────────
// LTF FY25 standalone (paidUpEquityCapital == faceValueShare == 2494.87,
// byte-for-byte, another bad source tag caught by plausibleFaceValue) and
// CANFINHOME FY25 standalone (bookValuePerShare stored as 506749.37, ₹5.07
// lakh/share) are the same failure by two different doors. CANFINHOME's own
// faceValueShare (₹2) is completely ordinary — plausibleFaceValue lets it
// through — but paidUpEquityCapital (0.02cr) is the corrupt figure this time,
// collapsing sharesCr to ~100,000 shares from the OTHER side of the division.
// A bound on the input can't cover every input that feeds one division, so
// meaningfulBookValue (derive-indas-annual.ts) bounds the OUTPUT instead — same
// principle as meaningfulLoansRatio above, grounded in the dataset's own
// observed range (see its doc comment there for the evidence, since 2026-08-11
// updated with the KOTAKBANK confirmation this was never an NBFC-only shape).
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decimalPerShare,
  pctChange,
  sumNonNull,
  avgNonNull,
} from "../ingester-utils.js";
// REUSED, NOT DUPLICATED — the exact "corrupt source, not a wide-column problem"
// gate already proven on the Ind-AS annual path (MOTILALOFS FY26 standalone hit
// it here first: see the header note below). Both are pure (no I/O), so importing
// them does not pull anything financial-industry-specific in. plausibleFaceValue()
// is the CALLER's job (ingest-nbfc-annual.ts / fill/re-derive.ts), not this module's
// — not imported here. meaningfulBookValue now lives in derive-indas-annual.ts too
// (moved out of this file when the same shape turned up on BankingFundamental/
// KOTAKBANK) — ONE shared definition, not three copies that could disagree.
import { boundDerived, meaningfulBookValue } from "./derive-indas-annual.js";

/**
 * A scale-free meaning bound, not a materiality floor — see the header note.
 * nim / creditCostPct / yieldOnAdvances / costOfFunds are all "annual flow ÷
 * average balance-sheet stock" ratios; no real lender's annual interest income
 * or cost exceeds its own average book, so |ratio| > 1 (100%) means the
 * denominator isn't a real loan/borrowings base for this row, not that the
 * ratio is unusually large.
 */
const MEANINGFUL_LOANS_RATIO_MAX_ABS = 1;

function meaningfulLoansRatio(v: number | null): number | null {
  return v !== null && Math.abs(v) <= MEANINGFUL_LOANS_RATIO_MAX_ABS ? v : null;
}

export interface NbfcAnnualRaw {
  interestIncome: number | null;
  financeCosts: number | null;
  loans: number | null;
  totalIncome: number | null;
  feeAndCommissionIncome: number | null;
  netGainOnFairValueChanges: number | null;
  otherIncome: number | null;
  employeeBenefitExpense: number | null;
  depreciation: number | null;
  otherExpenses: number | null;
  feeAndCommissionExpense: number | null;
  impairmentOnFinancialInstruments: number | null;
  debtSecurities: number | null;
  borrowings: number | null;
  subordinatedLiabilities: number | null;
  depositsLiabilities: number | null;
  totalEquity: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalAssets: number | null;
  paidUpEquityCapital: number | null;
  /** Caller-sanitised via plausibleFaceValue() — see the header note above. */
  faceValueShareSane: number | null;
  netProfit: number | null;
  revenue: number | null;
}

export interface NbfcAnnualPrior {
  revenue: number | null;
  netProfit: number | null;
  loans: number | null;
  totalEquity: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  debtSecurities: number | null;
  borrowings: number | null;
  subordinatedLiabilities: number | null;
  depositsLiabilities: number | null;
}

export interface NbfcAnnualDerivedColumns {
  nim: Prisma.Decimal | null;
  costToIncomeRatio: Prisma.Decimal | null;
  creditCostPct: Prisma.Decimal | null;
  spread: Prisma.Decimal | null;
  capitalToAssetsRatio: Prisma.Decimal | null;
  borrowingsToEquity: Prisma.Decimal | null;
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  aumGrowthYoy: Prisma.Decimal | null;
  revenueGrowthYoy: Prisma.Decimal | null;
  patGrowthYoy: Prisma.Decimal | null;
}

export interface NbfcAnnualDerived {
  columns: NbfcAnnualDerivedColumns;
  numbers: { revenueGrowthYoy: number | null };
}

export function deriveNbfcAnnual(
  raw: NbfcAnnualRaw,
  prior: NbfcAnnualPrior | null,
  tag: string,
): NbfcAnnualDerived {
  const totalBorrowings = sumNonNull(
    raw.debtSecurities,
    raw.borrowings,
    raw.subordinatedLiabilities,
    raw.depositsLiabilities,
  );

  const netWorth = raw.totalEquity ?? sumNonNull(raw.equityShareCapital, raw.otherEquity);

  const priorLoans = prior?.loans ?? null;
  const avgLoans = avgNonNull(raw.loans, priorLoans);

  const nii =
    raw.interestIncome !== null && raw.financeCosts !== null
      ? raw.interestIncome - raw.financeCosts
      : null;
  const nim = meaningfulLoansRatio(
    nii !== null && avgLoans !== null && avgLoans !== 0 ? nii / avgLoans : null,
  );

  const totalIncomeForC2I =
    raw.totalIncome ??
    sumNonNull(
      raw.interestIncome,
      raw.feeAndCommissionIncome,
      raw.netGainOnFairValueChanges,
      raw.otherIncome,
    );
  const opEx = sumNonNull(
    raw.employeeBenefitExpense,
    raw.depreciation,
    raw.otherExpenses,
    raw.feeAndCommissionExpense,
  );
  const costToIncomeRatio =
    opEx !== null && nii !== null && totalIncomeForC2I !== null
      ? opEx / (totalIncomeForC2I - (raw.financeCosts ?? 0))
      : null;

  const creditCostPct = meaningfulLoansRatio(
    raw.impairmentOnFinancialInstruments !== null && avgLoans !== null && avgLoans !== 0
      ? raw.impairmentOnFinancialInstruments / avgLoans
      : null,
  );

  const priorBorrowings = prior
    ? sumNonNull(
        prior.debtSecurities,
        prior.borrowings,
        prior.subordinatedLiabilities,
        prior.depositsLiabilities,
      )
    : null;
  const avgBorrowings = avgNonNull(totalBorrowings, priorBorrowings);
  const yieldOnAdvances = meaningfulLoansRatio(
    raw.interestIncome !== null && avgLoans !== null && avgLoans !== 0
      ? raw.interestIncome / avgLoans
      : null,
  );
  const costOfFunds = meaningfulLoansRatio(
    raw.financeCosts !== null && avgBorrowings !== null && avgBorrowings !== 0
      ? raw.financeCosts / avgBorrowings
      : null,
  );
  const spread =
    yieldOnAdvances !== null && costOfFunds !== null ? yieldOnAdvances - costOfFunds : null;

  const capitalToAssetsRatio =
    netWorth !== null && raw.totalAssets !== null && raw.totalAssets !== 0
      ? netWorth / raw.totalAssets
      : null;

  const borrowingsToEquity =
    totalBorrowings !== null && netWorth !== null && netWorth !== 0
      ? totalBorrowings / netWorth
      : null;

  let bookValuePerShare: number | null = null;
  if (
    netWorth !== null &&
    raw.paidUpEquityCapital !== null &&
    raw.paidUpEquityCapital > 0 &&
    raw.faceValueShareSane !== null &&
    raw.faceValueShareSane > 0
  ) {
    const sharesCr = raw.paidUpEquityCapital / raw.faceValueShareSane;
    if (sharesCr > 0) bookValuePerShare = netWorth / sharesCr;
  }

  const priorNetWorth = prior
    ? (prior.totalEquity ?? sumNonNull(prior.equityShareCapital, prior.otherEquity))
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? raw.netProfit / avgEquity
      : null;

  const aumGrowthYoy = pctChange(raw.loans, prior?.loans ?? null);
  const revenueGrowthYoy = pctChange(raw.revenue, prior?.revenue ?? null);
  const patGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);

  return {
    columns: {
      nim: decimalRatio(nim),
      costToIncomeRatio: decimalRatio(costToIncomeRatio),
      creditCostPct: decimalRatio(creditCostPct),
      spread: decimalRatio(spread),
      capitalToAssetsRatio: decimalRatio(capitalToAssetsRatio),
      borrowingsToEquity: decimalPct(borrowingsToEquity),
      netWorth: safeNumber(netWorth),
      bookValuePerShare: boundDerived(decimalPerShare(meaningfulBookValue(bookValuePerShare)), 6, "bookValuePerShare", tag),
      roe: decimalRatio(roe),
      aumGrowthYoy: decimalPct(aumGrowthYoy),
      revenueGrowthYoy: decimalPct(revenueGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
    },
    numbers: { revenueGrowthYoy },
  };
}
