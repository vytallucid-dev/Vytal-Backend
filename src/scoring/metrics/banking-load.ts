// File: src/scoring/metrics/banking-load.ts
//
// STANDALONE loader for the BANKING metric raw-value layer. The banking analogue of
// metrics/load.ts: SELECTs resultType="standalone" banking rows + the bank's
// BankSupplementary (CASA/Tier-1) and normalizes Decimal→number into the pure
// BankingCtx. NEVER reads consolidated. A missing standalone period is simply fewer
// rows (the pure fns surface UNAVAILABLE). PURE shapes out; DB in.

import { prisma } from "../../db/prisma.js";
import { fyOrdinal, quarterOrdinal } from "./types.js";
import { periodOrdinal } from "./banking-types.js";
import type { BankingAnnual, BankingQuarter, BankingCtx, SupplementaryPoint } from "./banking-types.js";

const n = (d: { toNumber: () => number } | null): number | null => (d === null ? null : d.toNumber());

export async function loadBankingAnnualStandalone(stockId: string, reportDateCutoff?: Date): Promise<BankingAnnual[]> {
  const rows = await prisma.bankingFundamental.findMany({
    where: { stockId, resultType: "standalone", ...(reportDateCutoff ? { reportDate: { lte: reportDateCutoff } } : {}) },
    orderBy: { fiscalYear: "asc" },
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    fyOrdinal: fyOrdinal(r.fiscalYear),
    interestEarned: n(r.interestEarned),
    interestExpended: n(r.interestExpended),
    otherIncome: n(r.otherIncome),
    operatingExpenses: n(r.operatingExpenses),
    ppop: n(r.ppop),
    profitBeforeTax: n(r.profitBeforeTax),
    netProfit: n(r.netProfit),
    advances: n(r.advances),
    investments: n(r.investments),
    cashAndBalancesWithRbi: n(r.cashAndBalancesWithRbi),
    balancesWithBanks: n(r.balancesWithBanks),
    totalAssets: n(r.totalAssets),
    deposits: n(r.deposits),
    gnpaAbsolute: n(r.gnpaAbsolute),
    nnpaAbsolute: n(r.nnpaAbsolute),
    gnpaPct: n(r.gnpaPct),
    nnpaPct: n(r.nnpaPct),
    cet1Ratio: n(r.cet1Ratio),
    additionalTier1Ratio: n(r.additionalTier1Ratio),
    tier1Ratio: n(r.tier1Ratio),
    roaDisclosed: n(r.roaDisclosed),
    stored: {
      pcr: n(r.pcr),
      costToIncomeRatio: n(r.costToIncomeRatio),
      netInterestMargin: n(r.netInterestMargin),
      nii: n(r.nii),
    },
  }));
}

export async function loadBankingQuarterlyStandalone(stockId: string, reportDateCutoff?: Date): Promise<BankingQuarter[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stockId, resultType: "standalone", ...(reportDateCutoff ? { reportDate: { lte: reportDateCutoff } } : {}) },
    orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    quarter: r.quarter,
    qOrdinal: quarterOrdinal(r.fiscalYear, r.quarter),
    interestEarned: n(r.interestEarned),
    interestExpended: n(r.interestExpended),
    otherIncome: n(r.otherIncome),
    operatingExpenses: n(r.operatingExpenses),
    ppop: n(r.ppop),
    netProfit: n(r.netProfit),
    gnpaAbsolute: n(r.gnpaAbsolute),
    nnpaAbsolute: n(r.nnpaAbsolute),
    gnpaPct: n(r.gnpaPct),
    nnpaPct: n(r.nnpaPct),
    cet1Ratio: n(r.cet1Ratio),
    additionalTier1Ratio: n(r.additionalTier1Ratio),
    roaQuarterly: n(r.roaQuarterly),
  }));
}

/** Load a bank's BankSupplementary (latest version per cell) into CASA + Tier-1 maps.
 *  CELL KEY: a quarter-keyed row (quarter≠null) keys as "FYxx/Qn" (e.g. "FY26/Q2");
 *  a legacy annual/LIVE row (quarter=null) keys by its bare fiscalYear ("FY26", "LIVE").
 *  This lets FY26/Q1, FY26/Q2 and the legacy LIVE/annual rows COEXIST without collision,
 *  and keeps Tier-1 (which has no quarter rows) bare-FY-keyed exactly as before. */
export async function loadSupplementary(symbol: string): Promise<{ casa: Map<string, SupplementaryPoint>; tier1: Map<string, SupplementaryPoint> }> {
  const rows = await prisma.bankSupplementary.findMany({
    where: { symbol, metric: { in: ["casa_pct", "tier1_pct"] } },
    orderBy: { version: "desc" }, // newest version first → first-seen wins per cell
    select: { metric: true, fiscalYear: true, quarter: true, value: true, status: true, confidence: true, createdAt: true },
  });
  const casa = new Map<string, SupplementaryPoint>();
  const tier1 = new Map<string, SupplementaryPoint>();
  for (const r of rows) {
    const target = r.metric === "casa_pct" ? casa : tier1;
    const key = r.quarter ? `${r.fiscalYear}/${r.quarter}` : r.fiscalYear; // quarter-keyed vs legacy bare-FY
    if (target.has(key)) continue; // first (newest version) wins per cell — its createdAt = last write to this cell
    target.set(key, { fiscalYear: r.fiscalYear, quarter: r.quarter, value: n(r.value), status: r.status, confidence: r.confidence, createdAt: r.createdAt });
  }
  return { casa, tier1 };
}

/** PIT cutoff for the QUARTER-KEYED CASA snapshot read (historical rescore). A live run
 *  reads the newest CASA overall; a HISTORICAL period must resolve CASA against ONLY
 *  ≤-period rows (no future quarter leaking into a past snapshot). This filter keeps:
 *    • quarter-keyed rows with periodOrdinal ≤ the cutoff (the tier-1 candidates ≤ period);
 *    • legacy ANNUAL rows (quarter=null, real FY) — the L3 own-history archive, unchanged;
 *  and DROPS the legacy "LIVE" marker (its conceptual period is "now" — future to any past
 *  snapshot, so a PIT rescore must never fall back to it). resolveCasa then picks the newest
 *  quarter ≤ period (tier 1), exactly as a point-in-time scorer should. */
function filterCasaToPit(casa: Map<string, SupplementaryPoint>, cutoffOrdinal: number): Map<string, SupplementaryPoint> {
  const out = new Map<string, SupplementaryPoint>();
  for (const [key, p] of casa) {
    if (p.quarter !== null) {
      if (periodOrdinal(p.fiscalYear, p.quarter) <= cutoffOrdinal) out.set(key, p); // tier-1 candidate ≤ period
    } else if (p.fiscalYear !== "LIVE") {
      out.set(key, p); // legacy annual FYxx — L3 own-history only, retained as-is
    }
    // else: legacy "LIVE" marker — excluded from a point-in-time past snapshot
  }
  return out;
}

/** "FY26Q2" → periodOrdinal("FY26","Q2") = 105. The PIT cutoff for the CASA filter. */
function casaCutoffOrdinal(periodKey: string): number {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  if (!m) throw new Error(`loadBankingCtx: cannot derive CASA cutoff ordinal from periodKey '${periodKey}'`);
  return periodOrdinal(`FY${m[1]}`, `Q${m[2]}`);
}

/** Build the full banking compute context for a stock.
 *  `reportDateCutoff` (point-in-time backfill) restricts annual + quarterly rows to
 *  periods whose report date is ≤ the cutoff.
 *  `casaPeriodKey` (point-in-time backfill) restricts the QUARTER-KEYED CASA snapshot
 *  read to rows with period ≤ that periodKey (e.g. "FY26Q2"), so a historical rescore
 *  resolves CASA against only ≤-period data — NO future quarter leaks backward. Omitted
 *  on the live path, where CASA resolves to the newest quarter overall (current behavior).
 *  Tier-1 (XBRL-primary) is never filtered here — only the CASA map is gated. */
export async function loadBankingCtx(symbol: string, stockId: string, reportDateCutoff?: Date, casaPeriodKey?: string): Promise<BankingCtx> {
  const [annual, quarterly, supp] = await Promise.all([
    loadBankingAnnualStandalone(stockId, reportDateCutoff),
    loadBankingQuarterlyStandalone(stockId, reportDateCutoff),
    loadSupplementary(symbol),
  ]);
  const casa = casaPeriodKey ? filterCasaToPit(supp.casa, casaCutoffOrdinal(casaPeriodKey)) : supp.casa;
  return { symbol, annual, quarterly, casa, tier1: supp.tier1 };
}
