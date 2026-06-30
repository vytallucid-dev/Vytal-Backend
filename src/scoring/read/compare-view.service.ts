// File: src/scoring/read/compare-view.service.ts
//
// THE COMPARISON ALIGNMENT SERVICE — the real product of the Comparison tool.
//
// Given two symbols it fetches BOTH entities' existing per-stock views (health,
// fundamentals, price, ownership) IN PARALLEL, runs the alignment logic, and emits ONE
// curated ComparisonView. No new data bank, no new tables — pure assembly + alignment
// over the existing read services.
//
// The alignment manifest is the single source of truth for what is honestly comparable:
//   • UNIVERSAL    — lines up for ANY two stocks (health composite/pillars/band/etc;
//                    the cross-family fundamentals subset; price returns; ownership %).
//   • FAMILY-LOCKED — lines up ONLY within the same family (a bank's NIM vs a bank's
//                    NIM, never a bank's NIM vs a non-financial's ROCE).
//   • WITHIN-PG     — each entity's own rank; never compared across different peer groups.
//
// GUARDRAILS (encoded, never reintroduced): NO winner of any kind; NO phantom metrics
// (only real fields from the actual payloads); honest-empty per metric (null stays null).
// Class-framing IS intentional: sectorClass flows through from each entity's health view
// identity; classContext is computed at the top level as interpretive context only —
// no prediction, no "better pick", no recommendation.

import { buildHealthSnapshotView } from "./health-view.service.js";
import { buildFundamentalsView } from "./fundamentals-view.service.js";
import { buildPriceView } from "./price-view.service.js";
import { buildOwnershipView } from "./ownership-series.service.js";
import { classGroupOf } from "../findings/section2/class-group.js";
import type { ClassGroup } from "../findings/section2/class-group.js";
import type { HealthSnapshotView, PillarKey, SectorClass } from "./health-view.types.js";
import type {
  FundamentalsView,
  IndustryFamily,
} from "./fundamentals-view.types.js";
import type { StockPriceView } from "./price-view.types.js";
import type { OwnershipSeriesView } from "./ownership-series.types.js";
import type {
  ClassContext,
  Comparability,
  Comparee,
  ComparisonView,
  FamilyMetric,
  UniversalMetric,
} from "./compare-view.types.js";

const PILLAR_KEYS: PillarKey[] = ["foundation", "momentum", "market", "ownership"];

/** Honest display labels for each family — used in identity + cross-family warnings. */
const FAMILY_LABEL: Record<IndustryFamily, string> = {
  non_financial: "Non-Financial",
  banking: "Banking",
  nbfc: "NBFC",
  life_insurance: "Life Insurance",
  general_insurance: "General Insurance",
};

/** Everything fetched for one entity. health/fundamentals are null only when the
 *  symbol doesn't exist in the universe (→ 404 upstream). price/ownership may be null
 *  for a stock with no such rows (honest-empty — the universal metrics they back go null). */
interface EntityData {
  health: HealthSnapshotView | null;
  fundamentals: FundamentalsView;
  price: StockPriceView | null;
  ownership: OwnershipSeriesView | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal-fundamentals extraction — the cross-family subset present in EVERY
// family's annual snapshot. The ONLY honestly-universal financial axis. Note the
// family-specific source-field differences folded to a common shape:
//   • non_financial growth field is `profitGrowthYoy`; every other family is `patGrowthYoy`.
//   • non_financial has no `netWorth` line → use `totalEquity` (the same magnitude).
// ─────────────────────────────────────────────────────────────────────────────
interface UniversalAnnual {
  roe: number | null;
  basicEps: number | null;
  bookValuePerShare: number | null;
  patGrowthYoy: number | null;
  totalAssets: number | null;
  netWorth: number | null;
}

function emptyUniversalAnnual(): UniversalAnnual {
  return {
    roe: null,
    basicEps: null,
    bookValuePerShare: null,
    patGrowthYoy: null,
    totalAssets: null,
    netWorth: null,
  };
}

function universalAnnual(f: FundamentalsView): UniversalAnnual {
  switch (f.family) {
    case "non_financial": {
      const a = f.nonFinancial?.annual;
      if (!a) return emptyUniversalAnnual();
      return {
        roe: a.roe,
        basicEps: a.basicEps,
        bookValuePerShare: a.bookValuePerShare,
        patGrowthYoy: a.profitGrowthYoy, // non-financial's pat-growth equivalent
        totalAssets: a.totalAssets,
        netWorth: a.totalEquity, // non-financial has no netWorth line
      };
    }
    case "banking": {
      const a = f.banking?.annual;
      if (!a) return emptyUniversalAnnual();
      return {
        roe: a.roe,
        basicEps: a.basicEps,
        bookValuePerShare: a.bookValuePerShare,
        patGrowthYoy: a.patGrowthYoy,
        totalAssets: a.totalAssets,
        netWorth: a.netWorth,
      };
    }
    case "nbfc": {
      const a = f.nbfc?.annual;
      if (!a) return emptyUniversalAnnual();
      return {
        roe: a.roe,
        basicEps: a.basicEps,
        bookValuePerShare: a.bookValuePerShare,
        patGrowthYoy: a.patGrowthYoy,
        totalAssets: a.totalAssets,
        netWorth: a.netWorth,
      };
    }
    case "life_insurance": {
      const a = f.lifeInsurance?.annual;
      if (!a) return emptyUniversalAnnual();
      return {
        roe: a.roe,
        basicEps: a.basicEps,
        bookValuePerShare: a.bookValuePerShare,
        patGrowthYoy: a.patGrowthYoy,
        totalAssets: a.totalAssets,
        netWorth: a.netWorth,
      };
    }
    case "general_insurance": {
      const a = f.generalInsurance?.annual;
      if (!a) return emptyUniversalAnnual();
      return {
        roe: a.roe,
        basicEps: a.basicEps,
        bookValuePerShare: a.bookValuePerShare,
        patGrowthYoy: a.patGrowthYoy,
        totalAssets: a.totalAssets,
        netWorth: a.netWorth,
      };
    }
    default:
      return emptyUniversalAnnual();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Family-specific extraction — each family's locked metric set. These compare ONLY
// within the same family. Built from the confirmed field map; every key is a REAL
// field in the corresponding annual payload (no phantom metrics). Units are honest:
// borrowingsToEquity / solvencyRatio are MULTIPLES, never percents.
// ─────────────────────────────────────────────────────────────────────────────
function familySpecific(f: FundamentalsView): FamilyMetric[] {
  switch (f.family) {
    case "non_financial": {
      const a = f.nonFinancial?.annual;
      if (!a) return [];
      return [
        { key: "roce", label: "ROCE", unit: "pct", value: a.roce },
        { key: "operatingMargin", label: "Operating Margin", unit: "pct", value: a.operatingMargin },
        { key: "netMargin", label: "Net Margin", unit: "pct", value: a.netMargin },
        { key: "fcf", label: "Free Cash Flow", unit: "cr", value: a.fcf },
        { key: "capex", label: "Capex", unit: "cr", value: a.capex },
        { key: "currentRatio", label: "Current Ratio", unit: "ratio", value: a.currentRatio },
        { key: "quickRatio", label: "Quick Ratio", unit: "ratio", value: a.quickRatio },
        { key: "debtToEquity", label: "Debt / Equity", unit: "ratio", value: a.debtToEquity },
        { key: "interestCoverage", label: "Interest Coverage", unit: "multiple", value: a.interestCoverage },
        { key: "cashFromOperating", label: "Cash from Operating", unit: "cr", value: a.cashFromOperating },
        { key: "cashFromInvesting", label: "Cash from Investing", unit: "cr", value: a.cashFromInvesting },
        { key: "cashFromFinancing", label: "Cash from Financing", unit: "cr", value: a.cashFromFinancing },
      ];
    }
    case "banking": {
      const a = f.banking?.annual;
      if (!a) return [];
      return [
        { key: "nim", label: "Net Interest Margin", unit: "pct", value: a.nim },
        { key: "gnpaPct", label: "GNPA", unit: "pct", value: a.gnpaPct },
        { key: "nnpaPct", label: "NNPA", unit: "pct", value: a.nnpaPct },
        { key: "pcr", label: "Provision Coverage Ratio", unit: "pct", value: a.pcr },
        { key: "cet1", label: "CET1", unit: "pct", value: a.cet1 },
        { key: "tier1", label: "Tier 1", unit: "pct", value: a.tier1 },
        { key: "costToIncome", label: "Cost to Income", unit: "pct", value: a.costToIncome },
        { key: "creditDepositRatio", label: "Credit / Deposit Ratio", unit: "pct", value: a.creditDepositRatio },
        { key: "cashFromOperating", label: "Cash from Operating", unit: "cr", value: a.cashFromOperating },
        { key: "cashFromInvesting", label: "Cash from Investing", unit: "cr", value: a.cashFromInvesting },
        { key: "cashFromFinancing", label: "Cash from Financing", unit: "cr", value: a.cashFromFinancing },
      ];
    }
    case "nbfc": {
      const a = f.nbfc?.annual;
      if (!a) return [];
      return [
        { key: "nim", label: "Net Interest Margin", unit: "pct", value: a.nim },
        { key: "spread", label: "Spread", unit: "pct", value: a.spread },
        // borrowingsToEquity is a LEVERAGE MULTIPLE (3.13×), NOT a percent — never line
        // it up against a non-financial's debt/equity ratio. Family-locked by design.
        { key: "borrowingsToEquity", label: "Borrowings / Equity", unit: "multiple", value: a.borrowingsToEquity },
        { key: "capitalToAssetsRatio", label: "Capital / Assets", unit: "pct", value: a.capitalToAssetsRatio },
        { key: "creditCostPct", label: "Credit Cost", unit: "pct", value: a.creditCostPct },
        { key: "costToIncomeRatio", label: "Cost to Income", unit: "pct", value: a.costToIncomeRatio },
        { key: "cashFromOperating", label: "Cash from Operating", unit: "cr", value: a.cashFromOperating },
        { key: "cashFromInvesting", label: "Cash from Investing", unit: "cr", value: a.cashFromInvesting },
        { key: "cashFromFinancing", label: "Cash from Financing", unit: "cr", value: a.cashFromFinancing },
      ];
    }
    case "life_insurance": {
      const a = f.lifeInsurance?.annual;
      if (!a) return [];
      return [
        { key: "solvencyRatio", label: "Solvency Ratio", unit: "multiple", value: a.solvencyRatio },
        { key: "newBusinessPremiumPct", label: "New Business Premium %", unit: "pct", value: a.newBusinessPremiumPct },
        { key: "expenseRatioPolicyholders", label: "Expense Ratio (Policyholders)", unit: "pct", value: a.expenseRatioPolicyholders },
        { key: "persistencyM13", label: "Persistency 13M", unit: "pct", value: a.persistency.m13 },
        { key: "persistencyM25", label: "Persistency 25M", unit: "pct", value: a.persistency.m25 },
        { key: "persistencyM37", label: "Persistency 37M", unit: "pct", value: a.persistency.m37 },
        { key: "persistencyM49", label: "Persistency 49M", unit: "pct", value: a.persistency.m49 },
        { key: "persistencyM61", label: "Persistency 61M", unit: "pct", value: a.persistency.m61 },
      ];
    }
    case "general_insurance": {
      const a = f.generalInsurance?.annual;
      if (!a) return [];
      return [
        { key: "solvencyRatio", label: "Solvency Ratio", unit: "multiple", value: a.solvencyRatio },
        // combinedRatio is a percent that CAN EXCEED 100 (above 100 = underwriting loss).
        { key: "combinedRatio", label: "Combined Ratio", unit: "pct", value: a.combinedRatio },
        { key: "incurredClaimRatio", label: "Incurred Claim Ratio", unit: "pct", value: a.incurredClaimRatio },
        { key: "netUnderwritingMargin", label: "Net Underwriting Margin", unit: "pct", value: a.netUnderwritingMargin },
        { key: "expensesOfManagementRatio", label: "Expenses of Management Ratio", unit: "pct", value: a.expensesOfManagementRatio },
        { key: "netRetentionRatio", label: "Net Retention Ratio", unit: "pct", value: a.netRetentionRatio },
      ];
    }
    default:
      return [];
  }
}

/** Pull a pillar subtotal from the health view (null when unscored / pillar absent). */
function pillarSubtotal(health: HealthSnapshotView | null, key: PillarKey): number | null {
  const p = health?.pillars?.find((x) => x.pillar === key);
  return p ? p.subtotal : null;
}

/** Assemble one side of the comparison from its fetched data. */
function buildComparee(symbol: string, data: EntityData): Comparee {
  const { health, fundamentals, price, ownership } = data;
  const ua = universalAnnual(fundamentals);
  const holding = ownership?.current?.holding ?? null;
  const verdict = health?.verdict ?? null;

  const peerStanding = health?.peerStanding
    ? {
        peerGroupId: health.peerStanding.peerGroupId,
        peerGroupName: health.identity.peerGroup?.displayName ?? null,
        rank: health.peerStanding.rank,
        percentile: health.peerStanding.percentile,
        memberCount: health.peerStanding.memberCount,
        perPillarRank: health.peerStanding.perPillarRank,
      }
    : null;

  return {
    symbol,
    name: fundamentals.name,
    family: fundamentals.family,
    familyLabel: FAMILY_LABEL[fundamentals.family],
    scored: health?.scored ?? false,
    identity: {
      sector: health?.identity.sector ?? null,
      sectorClass: health?.identity.sectorClass ?? null,
      peerGroup: health?.identity.peerGroup ?? null,
      asOfDate: health?.identity.asOfDate ?? "",
      periodKey: health?.identity.periodKey ?? "",
    },
    universal: {
      composite: verdict?.composite ?? null,
      band: verdict?.label.band ?? null,
      trajectoryMarker: verdict?.trajectoryMarker ?? null,
      divergenceFlag: verdict?.divergence.flag ?? null,
      divergenceGap: verdict?.divergence.gap ?? null,
      foundation: pillarSubtotal(health, "foundation"),
      momentum: pillarSubtotal(health, "momentum"),
      market: pillarSubtotal(health, "market"),
      ownership: pillarSubtotal(health, "ownership"),
      roe: ua.roe,
      basicEps: ua.basicEps,
      bookValuePerShare: ua.bookValuePerShare,
      patGrowthYoy: ua.patGrowthYoy,
      totalAssets: ua.totalAssets,
      netWorth: ua.netWorth,
      return1y: price?.stock.returns.r1y ?? null,
      return3y: price?.stock.returns.r3y ?? null,
      pctFrom52WHigh: price?.current.pctFrom52WHigh ?? null,
      pctFrom52WLow: price?.current.pctFrom52WLow ?? null,
      promoterPct: holding?.promoterPct ?? null,
      fiiPct: holding?.fiiPct ?? null,
      diiPct: holding?.diiPct ?? null,
      pledgedPctOfPromoter: holding?.pledgedPctOfPromoter ?? null,
      marketCap: price?.current.marketCap ?? null,
    },
    familySpecific: familySpecific(fundamentals),
    // Per-pillar metric depth — straight pass-through of the health view already in
    // memory (fetchEntity fetched it). ZERO new reads. Alignment of these (same vs
    // cross family) is decided downstream off the same comparability flag, not here.
    pillars: health?.pillars ?? [],
    // Qualitative health layer — all four are pass-throughs of the SAME in-memory health
    // view (ZERO new reads). Rendered per entity: findings as this entity's own fired list
    // (never row-paired), trajectorySeries on the shared 0–100 overlay, pondMask +
    // trajectoryDelta as facts about this entity (pond never cross-compared).
    findings: health?.findings ?? null,
    trajectorySeries: health?.trajectory?.series ?? [],
    pondMask: verdict?.pondMask ?? null,
    trajectoryDelta: verdict?.trajectoryDelta ?? null,
    peerStanding,
    // Recent insider/block activity — pass-through of the ownership view already in memory
    // (ZERO new reads). Empty arrays today (feeds wired-but-dormant) → UI shows "awaiting feed".
    events: ownership?.events ?? { insider: [], block: [] },
  };
}

/** The UNIVERSAL manifest — paired A vs B. Every row lines up for ANY two stocks,
 *  irrespective of family. Order is curated: health verdict → pillars → cross-family
 *  fundamentals → price → ownership. No metric here is family-locked. */
function buildUniversalMetrics(a: Comparee, b: Comparee): UniversalMetric[] {
  const ua = a.universal;
  const ub = b.universal;
  const m = (
    key: string,
    label: string,
    unit: UniversalMetric["unit"],
    av: number | string | null,
    bv: number | string | null,
  ): UniversalMetric => ({ key, label, unit, aValue: av, bValue: bv });

  return [
    m("composite", "Health Score", "score", ua.composite, ub.composite),
    m("band", "Health Band", "band", ua.band, ub.band),
    m("trajectoryMarker", "Trajectory", "marker", ua.trajectoryMarker, ub.trajectoryMarker),
    m("divergenceFlag", "Divergence", "flag", ua.divergenceFlag, ub.divergenceFlag),
    m("divergenceGap", "Divergence Gap", "score", ua.divergenceGap, ub.divergenceGap),
    m("foundation", "Foundation Pillar", "score", ua.foundation, ub.foundation),
    m("momentum", "Momentum Pillar", "score", ua.momentum, ub.momentum),
    m("market", "Market Pillar", "score", ua.market, ub.market),
    m("ownership", "Ownership Pillar", "score", ua.ownership, ub.ownership),
    m("roe", "Return on Equity", "pct", ua.roe, ub.roe),
    m("patGrowthYoy", "Profit Growth (YoY)", "pct", ua.patGrowthYoy, ub.patGrowthYoy),
    m("basicEps", "Basic EPS", "rupees", ua.basicEps, ub.basicEps),
    m("bookValuePerShare", "Book Value / Share", "rupees", ua.bookValuePerShare, ub.bookValuePerShare),
    m("totalAssets", "Total Assets", "cr", ua.totalAssets, ub.totalAssets),
    m("netWorth", "Net Worth", "cr", ua.netWorth, ub.netWorth),
    m("return1y", "1Y Price Return", "pct", ua.return1y, ub.return1y),
    m("return3y", "3Y Price Return", "pct", ua.return3y, ub.return3y),
    m("pctFrom52WHigh", "% from 52W High", "pct", ua.pctFrom52WHigh, ub.pctFrom52WHigh),
    m("pctFrom52WLow", "% from 52W Low", "pct", ua.pctFrom52WLow, ub.pctFrom52WLow),
    m("promoterPct", "Promoter Holding", "pct", ua.promoterPct, ub.promoterPct),
    m("fiiPct", "FII Holding", "pct", ua.fiiPct, ub.fiiPct),
    m("diiPct", "DII Holding", "pct", ua.diiPct, ub.diiPct),
    m("pledgedPctOfPromoter", "Promoter Pledge", "pct", ua.pledgedPctOfPromoter, ub.pledgedPctOfPromoter),
  ];
}

/** Build the class-level interpretive context note. Only called when both classes are
 *  non-null (all 20 fine-grained sectors are mapped). Reuses §2-Line-2 group vocabulary. */
function computeClassContext(
  aClass: Exclude<SectorClass, null>,
  bClass: Exclude<SectorClass, null>,
): ClassContext {
  const aGroup = classGroupOf(aClass) as ClassGroup; // all 6 enum values map; never null
  const bGroup = classGroupOf(bClass) as ClassGroup;

  const GROUP_DESC: Record<ClassGroup, string> = {
    A: "a strong floor historically means a calmer ride",
    B: "solvent through the cycle, not calm",
    C: "the story drives the ride; the floor caps structural risk",
  };

  const sameClass = aClass === bClass;
  const note = sameClass
    ? `Both are ${aClass} names — ${GROUP_DESC[aGroup]}. Metric readings for both sit within the same interpretive frame.`
    : aGroup === bGroup
      ? `${aClass} and ${bClass} are different classes but share the same profile — ${GROUP_DESC[aGroup]}. Their metrics read against a similar backdrop.`
      : `Different economic shapes: ${aClass} (${GROUP_DESC[aGroup]}) vs ${bClass} (${GROUP_DESC[bGroup]}). The same metric can read differently across these two backdrops.`;

  return { aClass, bClass, sameClass, note };
}

/** Fetch one entity's full data set in parallel. Returns null ⇔ the symbol is unknown
 *  (fundamentals is the family source AND the existence check). */
async function fetchEntity(symbol: string): Promise<EntityData | null> {
  const [health, fundamentals, price, ownership] = await Promise.all([
    buildHealthSnapshotView(symbol),
    buildFundamentalsView(symbol),
    buildPriceView(symbol),
    buildOwnershipView(symbol, 12),
  ]);
  if (!fundamentals) return null; // unknown symbol
  return { health, fundamentals, price, ownership };
}

/**
 * Build the curated stock-vs-stock comparison.
 *
 * Returns null when EITHER symbol is unknown (→ 404 upstream). Never throws on
 * honest-empty data — a missing price/ownership row simply leaves the metrics it backs
 * null.
 */
export async function buildComparisonView(
  symbolARaw: string,
  symbolBRaw: string,
): Promise<ComparisonView | null> {
  const symbolA = symbolARaw.toUpperCase().trim();
  const symbolB = symbolBRaw.toUpperCase().trim();

  // Both entities fetched fully in parallel (8 reads — 4 per side).
  const [dataA, dataB] = await Promise.all([fetchEntity(symbolA), fetchEntity(symbolB)]);
  if (!dataA || !dataB) return null;

  const a = buildComparee(symbolA, dataA);
  const b = buildComparee(symbolB, dataB);

  // ── Comparability: TWO TIERS, decided off the TRUE family (fundamentals.family,
  // NOT health.industryPath which collapses nbfc/insurance into non_financial). ──
  const comparability: Comparability =
    a.family === b.family ? "same_family" : "cross_family";
  const comparableDirectly = comparability === "same_family";

  // ── Peer standing: comparable ONLY when both have standing AND share the PG. ──
  const peerStandingComparable =
    a.peerStanding !== null &&
    b.peerStanding !== null &&
    a.peerStanding.peerGroupId === b.peerStanding.peerGroupId;

  // ── Warnings — the honest comparability boundary. No verdict, just the rules. ──
  const warnings: string[] = [];
  if (comparability === "cross_family") {
    warnings.push(
      `These companies are in different families (${a.familyLabel} vs ${b.familyLabel}); ` +
        `only universal measures line up directly. Family-specific metrics are shown ` +
        `separately and are not directly comparable.`,
    );
  }
  if (!peerStandingComparable && a.peerStanding && b.peerStanding) {
    warnings.push(
      `These companies sit in different peer groups (${a.peerStanding.peerGroupName ?? a.peerStanding.peerGroupId} ` +
        `vs ${b.peerStanding.peerGroupName ?? b.peerStanding.peerGroupId}); their within-group ranks ` +
        `are relative to different sets and are not directly comparable.`,
    );
  }

  const aClass = a.identity.sectorClass;
  const bClass = b.identity.sectorClass;
  const classContext: ClassContext | null =
    aClass !== null && bClass !== null ? computeClassContext(aClass, bClass) : null;

  return {
    a,
    b,
    comparability,
    universalMetrics: buildUniversalMetrics(a, b),
    familyContext: {
      a: a.familySpecific,
      b: b.familySpecific,
      comparableDirectly,
    },
    warnings,
    peerStandingComparable,
    classContext,
  };
}
