// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — THE WHOLE COMPANY. What "how is X doing" actually asks for.
//
// ── ★ WHY THIS EXISTS: A ROUTING BUG MADE A GENERAL QUESTION LOOK LIKE A NARROW ONE ───────────────
// "How is TCS doing?" is not a health-score question. It is a question about the company, and the
// answer should reach the quarter it just reported, what it earns, who owns it, how the price has
// behaved and what code has flagged — with the health score as ONE part of that, not the whole of it.
//
// The old behaviour was not a missing-component problem. `"how is"` was a token in the HEALTH LENS
// pattern, so every general question arrived carrying `lens: "health"` and matched a health-only
// composition. The lens is what the reader NARROWED to; a question that narrows nothing has none.
//
// ── ⚠ WHAT WE HOLD, AND WHAT WE DO NOT ────────────────────────────────────────────────────────────
// Measured for TCS: 32 quarters of revenue/profit/margin · an annual block (RoE 48.97, RoCE 62.21,
// margins, growth, D/E, interest cover) · market cap, FCF and dividend yield · 8 quarters of
// ownership with pledging · price against benchmark and sector · findings.
//
// NOT HELD, and this matters because a competitor's answer is full of them: deal wins / TCV,
// earnings-call commentary, segment-wise outlook, management guidance, AI revenue splits. Those come
// from transcripts and press releases we do not ingest. A section that wants one must say so (§6.4)
// rather than let the model fill the gap — N-1 exists precisely because that gap is where invention
// starts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { buildOverviewView } from "../scoring/read/overview-view.service.js";
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import { buildPriceView } from "../scoring/read/price-view.service.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, coverageReadFailed, resolved, type Resolved, type Source } from "./contract.js";
import { stockCoverage } from "./contract.js";

export interface QuarterLine {
  readonly periodKey: string;
  /**
   * ⚠ THE FIELD IS CALLED `revenue` AND THE VALUE IS NOT ALWAYS REVENUE. Every family files a top
   *   line; only the non-financials call it that. A bank files interest earned, an NBFC total income,
   *   a life insurer net premium income, a general insurer premium earned. The NAME is kept because
   *   four call sites read it; `topLabel` beside it is what a reader may be shown.
   */
  readonly revenue: number | null;
  /**
   * ★ THE READER-FACING NAME OF THE LINE ABOVE — XT, Phase 3.
   *
   * ⚠ WITHOUT IT THE ANSWER SAID "HDFC Life reported REVENUE of ₹16,548 Cr". An insurer files no
   *   revenue; that figure is net premium income, and calling it revenue is a small false statement
   *   about an account the reader may know better than we do.
   */
  readonly topLabel: string;
  readonly netProfit: number | null;
  readonly operatingMargin: number | null;
  /** YoY change vs the same quarter a year earlier. `null` when four quarters back is not held. */
  readonly revenueYoyPct: number | null;
  readonly profitYoyPct: number | null;
}

/** One row of the metric table — a figure with how it moved. `null` change = the comparison period
 *  is not held, which is different from "it did not move" and must not render as 0. */
export interface MetricRow {
  readonly label: string;
  readonly value: number | null;
  readonly unit: "cr" | "pct" | "x";
  /** ★ HOW THE CHANGE IS EXPRESSED, AND IT IS NOT ALWAYS A PERCENTAGE.
   *  A money line moves by a RELATIVE percentage: ₹72,275 Cr is +13.9% on ₹63,437 Cr.
   *  A percentage line moves by PERCENTAGE POINTS: RoE 48.97% against 52.66% is −3.7pp, not −7.0%.
   *  Printing the second as "%" claims a 7% relative change where the fact is a 3.7-point absolute
   *  one — the same conflation `EvidenceUnit` warns about ("`pp` AND `%` ARE NOT INTERCHANGEABLE and
   *  the distinction is load-bearing"), reproduced in a table instead of a pip. */
  readonly changeUnit: "pct" | "pp";
  readonly qoqPct: number | null;
  readonly yoyPct: number | null;
}

/** Parts of the register, as filed. Percentages of total equity. */
export interface ShareholdingSplit {
  readonly periodKey: string;
  readonly parts: readonly { key: string; label: string; pct: number }[];
  readonly promoterPct: number | null;
  readonly promoterDeltaPp: number | null;
  readonly instDeltaPp: number | null;
  readonly pledgedPctOfPromoter: number | null;
  readonly undisclosed: readonly string[];
}

export interface CompanySnapshot {
  readonly symbol: string;
  readonly name: string;
  readonly industry: string | null;
  readonly coreBusiness: string | null;
  readonly listedSince: string | null;
  readonly businessTags: readonly string[];
  readonly latest: QuarterLine | null;
  readonly annual: {
    readonly fiscalYear: string; readonly roe: number | null; readonly roce: number | null;
    readonly netMargin: number | null; readonly operatingMargin: number | null;
    readonly revenueGrowthYoy: number | null; readonly debtToEquity: number | null;
  } | null;
  readonly marketCapCr: number | null;
  readonly dividendYield: number | null;
  readonly priceReturn1y: number | null;
  readonly benchmarkReturn1y: number | null;
  readonly metrics: readonly MetricRow[];
  readonly annualRows: readonly MetricRow[];
  readonly shareholding: ShareholdingSplit | null;
  readonly ownershipTell: string | null;
  readonly promoterPct: number | null;
  readonly quartersHeld: number;
}

const n = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
const pct = (cur: number | null, prior: number | null): number | null =>
  cur === null || prior === null || prior === 0 ? null : Math.round(((cur - prior) / Math.abs(prior)) * 1000) / 10;

const ppDiff = (cur: number | null, prior: number | null): number | null =>
  cur === null || prior === null ? null : Math.round((cur - prior) * 100) / 100;

const row = (label: string, value: number | null, unit: MetricRow["unit"], prevQ: number | null, prevY: number | null): MetricRow => {
  // A percentage or a ratio moves in POINTS; money moves in relative percent. See MetricRow.changeUnit.
  const asPoints = unit === "pct" || unit === "x";
  const move = asPoints ? ppDiff : pct;
  return {
    label, value, unit,
    changeUnit: asPoints ? "pp" : "pct",
    qoqPct: move(value, prevQ), yoyPct: move(value, prevY),
  };
};

/** The register split, straight from the filing. ★ AN UNDISCLOSED CLASS IS NAMED, NOT ZEROED — the
 *  §3.4 defect in its rendering form: a pie that draws a missing bucket at 0% shows a register that
 *  adds to less than 100 and says nothing about why. */
async function shareholdingFor(stockId: string): Promise<ShareholdingSplit | null> {
  const rows = await prisma.shareholdingPattern.findMany({
    where: { stockId },
    orderBy: { asOnDate: "desc" },
    take: 2,
    select: {
      fiscalYear: true, quarter: true, promoterPct: true, fiiPct: true, diiPct: true,
      retailPct: true, othersPct: true, publicPct: true,
      pledgedShares: true, promoterShares: true,
    },
  });
  const cur = rows[0];
  if (!cur) return null;
  const prev = rows[1];
  const undisclosed: string[] = [];
  const take = (v: unknown, label: string): number | null => {
    const x = n(v);
    if (x === null) undisclosed.push(label);
    return x;
  };
  const promoter = take(cur.promoterPct, "Promoter");
  const fii = take(cur.fiiPct, "FII");
  const dii = take(cur.diiPct, "DII");
  const retail = n(cur.retailPct);
  const others = n(cur.othersPct);

  const parts: { key: string; label: string; pct: number }[] = [];
  if (promoter !== null) parts.push({ key: "promoter", label: "Promoter", pct: promoter });
  if (fii !== null) parts.push({ key: "fii", label: "FII", pct: fii });
  if (dii !== null) parts.push({ key: "dii", label: "DII", pct: dii });
  if (retail !== null) parts.push({ key: "retail", label: "Retail", pct: retail });
  const named = parts.reduce((a, b) => a + b.pct, 0);
  const rest = Math.round((100 - named) * 100) / 100;
  // ⚠ "Others" IS THE REMAINDER, AND ONLY WHEN THERE IS ONE. Falling back to the filing own
  //    `others_pct` when the named classes already sum to 100 double-counts it — TCS showed Retail
  //    5.70% and Others 5.70%, a register adding to 105.7%. The remainder is the only honest value
  //    here because it is the one that makes the parts sum to the whole.
  if (rest > 0.05) parts.push({ key: "others", label: "Others", pct: rest });
  void others;

  const pShares = cur.pledgedShares === null ? null : Number(cur.pledgedShares);
  const prShares = cur.promoterShares === null ? null : Number(cur.promoterShares);
  const pledged = pShares !== null && prShares !== null && prShares > 0
    ? Math.round((pShares / prShares) * 1000) / 10 : null;

  const instCur = fii !== null && dii !== null ? fii + dii : null;
  const pf = prev ? n(prev.fiiPct) : null;
  const pd = prev ? n(prev.diiPct) : null;
  const instPrev = pf !== null && pd !== null ? pf + pd : null;
  const pp = prev ? n(prev.promoterPct) : null;

  return {
    periodKey: `${cur.fiscalYear}${cur.quarter}`,
    parts,
    promoterPct: promoter,
    promoterDeltaPp: promoter !== null && pp !== null ? Math.round((promoter - pp) * 100) / 100 : null,
    instDeltaPp: instCur !== null && instPrev !== null ? Math.round((instCur - instPrev) * 100) / 100 : null,
    pledgedPctOfPromoter: pledged,
    undisclosed,
  };
}

export async function resolveCompanySnapshot(symbol: string): Promise<Resolved<CompanySnapshot>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym) return absent("not_in_universe", { subject: null, query: null });

  const cov = await resolveStockCoverage(sym);
  if (coverageReadFailed(cov)) return absent("read_failed", { subject: null, query: null });
  if (!cov.ok && cov.absent.reason === "not_in_universe") {
    return absent("not_in_universe", cov.coverage);
  }
  const stock = await prisma.stock.findUnique({ where: { symbol: sym }, select: { name: true } });
  if (!stock) return absent("not_in_universe", cov.coverage);

  // A tier-0 company has a name and a listing and nothing else. That is an ABSENCE with coverage
  // attached, not a snapshot full of nulls a renderer would have to test field by field.
  const quartersHeld = stockCoverage(cov.coverage)?.depth.quarters ?? 0;
  if (quartersHeld === 0) return absent("not_ingested", cov.coverage);

  const stockRow = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true } });
  const [ov, fv, pv, own] = await Promise.all([
    buildOverviewView(sym).catch(() => null),
    buildFundamentalsView(sym).catch(() => null),
    buildPriceView(sym).catch(() => null),
    buildOwnershipView(sym, 8).catch(() => null),
  ]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE FAMILY'S OWN BRANCH, NOT `nonFinancial` — XT · EXTENDED COVERAGE, Phase 3.
  //
  // ⚠⚠ THIS READ `fv.nonFinancial` AND NOTHING ELSE, SO THE BROADEST QUESTION IN THE PRODUCT WAS
  //    FIGURE-LESS FOR EVERY BANK, NBFC AND INSURER. Measured through `resolveCompanySnapshot`:
  //
  //      TCS         latest FY27Q1, 4 metrics, full annual   ✓
  //      HDFCBANK    latest null · annual null · 0 metrics   ✗   (33 quarters held under `banking`)
  //      BAJFINANCE  latest null · annual null · 0 metrics   ✗   (29 held under `nbfc`)
  //      HDFCLIFE    latest null · annual null · 0 metrics   ✗   (30 under `lifeInsurance`)
  //      GICRE       latest null · annual null · 0 metrics   ✗   (30 under `generalInsurance`)
  //
  //    "How is HDFCLIFE doing" therefore answered with ONE sentence — the company's name and listing
  //    year — over an anchor with nothing in it. That is 194 companies with real filed depth, and it
  //    is the exact failure XT names: not a complete answer that happens not to include scoring, but
  //    a scoring-shaped page with the figures missing too.
  //
  // ★ THE VIEW ALREADY CARRIES ALL FIVE BRANCHES and `family` says which one is live. F · Fundamentals
  //   has read them since Phase 1; this is the whole-company answer catching up.
  //
  // ⚠ AND THE HEADLINE LINE IS PER FAMILY, BECAUSE "REVENUE" IS NOT A UNIVERSAL. A bank files
  //   interest earned, an NBFC total income, a life insurer net premium, a general insurer premium
  //   earned. Reading `revenue` off a banking quarter returns undefined — which is how this stayed
  //   invisible: every field simply came back empty rather than wrong.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const family = String((fv as { family?: unknown } | null)?.family ?? "non_financial");
  const BRANCH: Record<string, string> = {
    non_financial: "nonFinancial", banking: "banking", nbfc: "nbfc",
    life_insurance: "lifeInsurance", general_insurance: "generalInsurance",
  };
  /** The top line each family actually files, and the words for it. `netProfit` is the one universal. */
  const TOP: Record<string, { key: string; label: string }> = {
    non_financial: { key: "revenue", label: "Revenue" },
    banking: { key: "interestEarned", label: "Interest earned" },
    nbfc: { key: "totalIncome", label: "Total income" },
    life_insurance: { key: "netPremiumIncome", label: "Net premium income" },
    general_insurance: { key: "premiumEarned", label: "Premium earned" },
  };
  const top = TOP[family] ?? TOP.non_financial!;
  const nf = ((fv as Record<string, unknown> | null)?.[BRANCH[family] ?? "nonFinancial"] as Record<string, unknown> | undefined) ?? null;
  const quarters = (nf?.quarters as Record<string, unknown>[] | undefined) ?? [];
  const last = quarters[quarters.length - 1];
  const yearAgo = quarters.length >= 5 ? quarters[quarters.length - 5] : undefined;

  const latest: QuarterLine | null = last
    ? {
        periodKey: String(last.periodKey),
        // ⚠ `revenue` IS THE NON-FINANCIAL NAME FOR IT — see the field's own note.
        revenue: n(last[top.key]),
        topLabel: top.label,
        netProfit: n(last.netProfit),
        operatingMargin: n(last.operatingMargin),
        revenueYoyPct: pct(n(last[top.key]), yearAgo ? n(yearAgo[top.key]) : null),
        profitYoyPct: pct(n(last.netProfit), yearAgo ? n(yearAgo.netProfit) : null),
      }
    : null;

  const a = nf?.annual as Record<string, unknown> | undefined;
  const yields = nf?.yields as Record<string, unknown> | undefined;
  const ownCur = (own as { current?: Record<string, unknown> } | null)?.current;
  const stockRet = (pv as { stock?: Record<string, unknown> } | null)?.stock;
  const benchRet = (pv as { benchmark?: Record<string, unknown> } | null)?.benchmark;

  // ── THE METRIC TABLE. Last quarter against the one before it and the same quarter a year ago.
  const prevQ = quarters.length >= 2 ? quarters[quarters.length - 2] : undefined;
  // ⚠ THE SECOND LINE IS PER FAMILY TOO. Operating profit is a non-financial idea; a bank's analogue
  //   is pre-provision operating profit, an NBFC's is net interest income, a general insurer's is the
  //   underwriting result, and a life insurer files none — so that row is simply absent there rather
  //   than present and empty. `row()` already drops a null, so an unfiled line costs nothing.
  const SECOND: Record<string, { key: string; label: string } | null> = {
    non_financial: { key: "operatingProfit", label: "Operating profit" },
    banking: { key: "ppop", label: "Pre-provision operating profit" },
    nbfc: { key: "nii", label: "Net interest income" },
    life_insurance: null,
    general_insurance: { key: "underwritingProfitOrLoss", label: "Underwriting profit or loss" },
  };
  // ⚠ `in`, NOT `??` — AND THE FIRST DRAFT USED `??`. `SECOND.life_insurance` is deliberately `null`
  //   ("a life insurer files no operating profit"), and `null ?? SECOND.non_financial` returns the
  //   FALLBACK, so life insurers were handed the non-financial row after all and rendered
  //   "Operating profit —". The nullish operator cannot tell a deliberate null from a missing key;
  //   `in` can, which is the whole reason the map holds an explicit null rather than omitting the key.
  const second = family in SECOND ? SECOND[family]! : SECOND.non_financial!;
  const metrics: MetricRow[] = last
    ? [
        row(top.label, n(last[top.key]), "cr", prevQ ? n(prevQ[top.key]) : null, yearAgo ? n(yearAgo[top.key]) : null),
        ...(second
          ? [row(second.label, n(last[second.key]), "cr", prevQ ? n(prevQ[second.key]) : null, yearAgo ? n(yearAgo[second.key]) : null)]
          : []),
        row("Net profit", n(last.netProfit), "cr", prevQ ? n(prevQ.netProfit) : null, yearAgo ? n(yearAgo.netProfit) : null),
        // ⚠ OPERATING MARGIN IS A NON-FINANCIAL LINE AND THE OTHER FOUR FAMILIES DO NOT FILE ONE.
        //   Kept as a row for them it renders "Operating margin —" on every bank, NBFC and insurer,
        //   which reads as a figure this quarter failed to report. It is not a gap: the concept does
        //   not exist in that account. `SECOND` above already carries each family's own analogue, and
        //   omitting a line a family never files is the same rule the statement table applies to its
        //   columns.
        ...(family === "non_financial"
          ? [row("Operating margin", n(last.operatingMargin), "pct", prevQ ? n(prevQ.operatingMargin) : null, yearAgo ? n(yearAgo.operatingMargin) : null)]
          : []),
      ]
    : [];

  const aSeries = (nf?.annualSeries as Record<string, unknown>[] | undefined) ?? [];
  const aCur = aSeries[aSeries.length - 1];
  const aPrev = aSeries.length >= 2 ? aSeries[aSeries.length - 2] : undefined;
  const annualRows: MetricRow[] = aCur
    ? [
        row("Return on equity", n(aCur.roe), "pct", null, aPrev ? n(aPrev.roe) : null),
        row("Return on capital", n(aCur.roce), "pct", null, aPrev ? n(aPrev.roce) : null),
        row("Operating margin", n(aCur.operatingMargin), "pct", null, aPrev ? n(aPrev.operatingMargin) : null),
        row("Net margin", n(aCur.netMargin), "pct", null, aPrev ? n(aPrev.netMargin) : null),
      ]
    : [];

  const shareholding = stockRow ? await shareholdingFor(stockRow.id) : null;

  const data: CompanySnapshot = {
    symbol: sym,
    name: stock.name,
    industry: (ov as { industry?: string } | null)?.industry ?? null,
    coreBusiness: (ov as { coreBusiness?: string } | null)?.coreBusiness ?? null,
    listedSince: (ov as { listedSince?: string } | null)?.listedSince ?? null,
    businessTags: ((ov as { businessTags?: string[] } | null)?.businessTags ?? []).slice(0, 5),
    latest,
    annual: a
      ? {
          fiscalYear: String(a.fiscalYear), roe: n(a.roe), roce: n(a.roce),
          netMargin: n(a.netMargin), operatingMargin: n(a.operatingMargin),
          revenueGrowthYoy: n(a.revenueGrowthYoy), debtToEquity: n(a.debtToEquity),
        }
      : null,
    marketCapCr: n(yields?.marketCap),
    dividendYield: n(yields?.dividendYield),
    priceReturn1y: n(stockRet?.return1y ?? stockRet?.["return_1y"]),
    benchmarkReturn1y: n(benchRet?.return1y ?? benchRet?.["return_1y"]),
    metrics, annualRows, shareholding,
    ownershipTell: (own as { tell?: string } | null)?.tell ?? null,
    promoterPct: n(ownCur?.promoterPct),
    quartersHeld,
  };

  const provenance: Source[] = ["stocks", "quarterly_results"];
  if ((stockCoverage(cov.coverage)?.tier ?? 0) === 2) provenance.push("score_snapshots");
  return resolved(data, cov.coverage, provenance);
}
