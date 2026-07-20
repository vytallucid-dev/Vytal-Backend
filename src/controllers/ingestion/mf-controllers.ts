// ─────────────────────────────────────────────────────────────
// MUTUAL-FUND PIPELINE CONTROLLERS (RULING ①b — no mystery cron).
//
// Mirrors the indices/prices controller pattern exactly: public read endpoints, admin manual
// triggers that enqueue a BackgroundJob and hand back a pollable status URL.
//
//   GET  /api/v1/mf/:schemeCode/analytics   — the computed row (+ its honest-empty ledger)
//   GET  /api/v1/mf/:schemeCode/chart       — LIVE per-fund NAV series (transient, not stored)
//   GET  /api/v1/mf/run-logs                — the MF pipeline's run history
//   POST /api/v1/admin/mf/nav/trigger       — manual amfi_nav_daily      (admin)
//   POST /api/v1/admin/mf/analytics/trigger — manual mf_analytics_daily  (admin)
// ─────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { fetchFundChart } from "../../ingestions/amfi/mf-chart.js";
import { parseBucket, normaliseCategory } from "../../ingestions/amfi/mf-category.js";
import { explainOmissions, OmissionCode } from "../../ingestions/amfi/mf-omissions.js";
import { splitDivisor, dayOf } from "../../ingestions/amfi/mf-split-adjust.js";
import { loadSplitsForScheme } from "../../ingestions/amfi/mf-splits-source.js";
import { classifyPlanOption } from "../../ingestions/amfi/mf-distributions.js";
import { resolveRepresentative } from "../../ingestions/amfi/mf-representative.js";

/** Named in the risk-free omission text so the reader knows WHICH series fell short. */
const RISK_FREE_INDEX_HINT = "Nifty 1D Rate Index";

// ── GET /api/v1/mf/:schemeCode/analytics ─────────────────────
// The computed analytics for one scheme.
//
// EVERY NULL SHIPS WITH ITS REASON. `omissions` is returned verbatim alongside the numbers, so
// a client can render "—" AND say why ("this fund is 2 years old", "we have no risk-free rate
// that far back") instead of silently showing a blank cell that looks like a bug.
export const getFundAnalytics = async (req: Request, res: Response) => {
  try {
    const schemeCode = String(req.params.schemeCode ?? "");
    if (!/^\d+$/.test(schemeCode)) {
      return res.status(400).json({ success: false, error: "Invalid scheme code" });
    }

    const row = await prisma.mfAnalytics.findUnique({ where: { schemeCode } });
    if (!row) {
      return res.status(404).json({
        success: false,
        error: "No analytics for this scheme yet",
        detail: "The nightly mf_analytics_daily job has not computed this scheme. This is not an error state for a newly-listed fund.",
      });
    }

    // STEP 13: ETFs are AMFI funds too, and the fold now computes their analytics. Fencing this
    // lookup to 'mutual_fund' would have served an ETF's metrics with a NULL identity block —
    // the numbers without the fund they belong to. `assetClass` is returned so a caller can tell
    // the two apart rather than having to infer it from the category string.
    const inst = await prisma.instrument.findFirst({
      where: { amfiSchemeCode: schemeCode, assetClass: { in: ["mutual_fund", "etf"] } },
      select: { symbol: true, assetClass: true, schemeName: true, fundHouse: true, category: true, planType: true, currentNav: true, navDate: true, isActive: true },
    });

    const bucket = row.rankBucket ? parseBucket(row.rankBucket) : null;

    return res.json({
      success: true,
      data: {
        schemeCode,
        scheme: inst
          ? {
              name: inst.schemeName,
              // An ETF trades under an exchange ticker; a mutual fund has none and this is NULL.
              // The 10 ETFs with no NSE listing (BSE-only / matured) are honestly NULL too.
              symbol: inst.symbol,
              assetClass: inst.assetClass,
              fundHouse: inst.fundHouse,
              category: inst.category,
              planType: inst.planType,
              currentNav: inst.currentNav,
              // navDate is NOT decoration. A carried-forward NAV keeps its OLD date, and that
              // date is the only thing distinguishing it from a fresh one. Never render the NAV
              // without it.
              navDate: inst.navDate,
              isActive: inst.isActive,
            }
          : null,
        asOfDate: row.asOfDate,
        navPoints: row.navPoints,
        // No `sinceEarliestCagr`, and no earliest-NAV anchor to caveat it with. Both are gone: the
        // metric was folded from AMFI's raw NAV, which is neither split-adjusted nor total-return,
        // so the longer the span the more corrupt the number — the opposite of what a client would
        // assume. We do not serve a figure we cannot compute honestly, so the field does not exist.
        returns: {
          m1: row.ret1m, m3: row.ret3m, m6: row.ret6m, y1: row.ret1y,
          y3Cagr: row.ret3yCagr, y5Cagr: row.ret5yCagr,
        },
        risk: {
          vol1y: row.vol1y, vol3y: row.vol3y,
          sharpe1y: row.sharpe1y, sharpe3y: row.sharpe3y, sharpe5y: row.sharpe5y,
          sortino1y: row.sortino1y, sortino3y: row.sortino3y,
          maxDrawdown1y: row.maxDrawdown1y, maxDrawdown3y: row.maxDrawdown3y, maxDrawdown5y: row.maxDrawdown5y,
        },
        rolling1y: {
          n: row.roll1yN, min: row.roll1yMin, max: row.roll1yMax,
          avg: row.roll1yAvg, pctPositive: row.roll1yPctPositive,
        },
        rank: bucket
          ? {
              category: bucket.leaf,
              planType: bucket.planType,
              // bucketSize = the whole category; pool* = the denominator each rank was measured
              // against (funds with a return that horizon). Render "y1 of pool1y", never "of bucketSize".
              bucketSize: row.rankBucketSize,
              y1: row.rank1y, y3: row.rank3y, y5: row.rank5y,
              pool1y: row.rankPool1y, pool3y: row.rankPool3y, pool5y: row.rankPool5y,
              pct1y: row.pct1y, pct3y: row.pct3y, pct5y: row.pct5y,
            }
          : null,
        // GROUP-3 (Step 18) — computed and stored on every fold, but never returned until now.
        // `index`/`via` are null together when no benchmark is defensible for this fund's category
        // (reason lands in `omissions.benchmark`); beta/alpha/trackingError are gated per-horizon
        // and explained the same way (`omissions.beta_1y` etc), same pattern as every other
        // NAV-derived metric on this response.
        benchmark: {
          index: row.benchmarkIndex,
          via: row.benchmarkVia,
          beta1y: row.beta1y, beta3y: row.beta3y, beta5y: row.beta5y,
          alpha1y: row.alpha1y, alpha3y: row.alpha3y, alpha5y: row.alpha5y,
          trackingError1y: row.trackingError1y, trackingError3y: row.trackingError3y, trackingError5y: row.trackingError5y,
        },
        /**
         * WHY each null above is null. Never omit this — a blank without a reason reads as a bug.
         *
         * Stored as compact CODES; expanded HERE into full sentences using the row's own columns
         * (nav_points, window_from, as_of_date, rank_bucket_size). The prose is composed at read
         * time rather than written 13,704 times — same information, none of the duplication.
         */
        omissions: explainOmissions(row.omissions, {
          navPoints: row.navPoints,
          windowFrom: row.windowFrom,
          asOfDate: row.asOfDate,
          rankBucketSize: row.rankBucketSize,
          riskFreeIndex: RISK_FREE_INDEX_HINT,
        }),
        computedAt: row.computedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /api/v1/mf/:schemeCode/chart?days=365 ────────────────
// The LIVE NAV series — fetched now, returned now, stored NEVER. And CORRECTED to match the metrics:
//
//   · IDCW / Bonus plan  → we draw its TIER-MATCHED GROWTH TWIN'S series (the very series its metrics
//     were measured on), so the +11.5% number and the picture beside it are the same fund. The
//     response says so (`via: "growth_twin"`, `seriesSchemeCode`) — a chart that were secretly the
//     twin's would be a lie of a different shape.
//   · SPLIT ETF          → split-adjusted with the SAME rule the fold uses (mf-split-adjust.ts), so a
//     1:10 sub-division no longer draws a 90% cliff.
//   · TWINLESS IDCW      → a 200 DECLINE carrying `idcw_nav_not_total_return` — a true, successful
//     "no": a raw payout-sawtoothed series is exactly what that reason exists to refuse. NOT a 503.
//
// The series to draw is the fold's OWN choice, stored in mf_analytics.series_scheme_code — read once,
// never re-resolved (re-deriving resolveTwins here would be a second implementation that drifts).
export const getFundChart = async (req: Request, res: Response) => {
  try {
    const schemeCode = String(req.params.schemeCode ?? "");
    const days = req.query.days ? Number(req.query.days) : undefined;
    if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
      return res.status(400).json({ success: false, error: "days must be a positive number" });
    }

    // STEP 13: an ETF's NAV series comes from the same AMFI history endpoint as a fund's.
    const known = await prisma.instrument.findFirst({
      where: { amfiSchemeCode: schemeCode, assetClass: { in: ["mutual_fund", "etf"] } },
      select: { id: true },
    });
    if (!known) {
      return res.status(404).json({ success: false, error: "Unknown AMFI scheme code" });
    }

    // The series the metrics were measured on. NULL ⇒ the fold DECLINED this plan (no total-return
    // series it stands behind). A scheme not folded yet has no row → fall back to its own series.
    const analytics = await prisma.mfAnalytics.findUnique({
      where: { schemeCode },
      select: { seriesSchemeCode: true, omissions: true },
    });

    if (analytics && analytics.seriesSchemeCode === null) {
      // A DECLINE is a successful answer to "can you draw this?" — no, and here is why. 200, not 503
      // (source down) and not 4xx (client error): an honest-empty state, carrying the reason so the
      // frontend must render it.
      const om = (analytics.omissions ?? {}) as Record<string, string>;
      return res.status(200).json({
        success: true,
        data: {
          schemeCode,
          declined: true,
          reason: om.ret_1y ?? OmissionCode.IDCW_NAV_NOT_TOTAL_RETURN,
          stored: false,
        },
      });
    }

    const seriesCode = analytics?.seriesSchemeCode ?? schemeCode;
    const via: "self" | "growth_twin" = seriesCode === schemeCode ? "self" : "growth_twin";

    const chart = await fetchFundChart(seriesCode, { days });
    if (!chart.ok) {
      // 503: the chart is UNAVAILABLE (source down / unknown at source) — a DIFFERENT fact from a
      // decline, and it must never be confusable with one.
      return res.status(503).json({
        success: false,
        error: "Chart unavailable",
        detail: chart.reason,
        source: chart.source,
      });
    }

    // ── SPLIT-ADJUST via the ONE shared rule. Every real split is an ETF, drawn `self`; an IDCW
    //    plan's Growth twin is a mutual fund with no splits, so its points pass through unchanged
    //    (byte-identical). A fund with no splits short-circuits before any per-point work. ──
    const splits = await loadSplitsForScheme(seriesCode);
    let splitAdjusted = false;
    const points =
      splits.length === 0
        ? chart.points
        : chart.points.map((p) => {
            const f = splitDivisor(dayOf(p.date), splits);
            if (f === 1) return p;
            splitAdjusted = true;
            return { date: p.date, nav: String(Number(p.nav) / f) };
          });

    return res.json({
      success: true,
      data: {
        schemeCode, // what the user asked for
        /** The scheme code we ACTUALLY drew — self, or the Growth twin for an IDCW/Bonus plan. */
        seriesSchemeCode: seriesCode,
        /** "self" | "growth_twin" — the frontend says "showing the Growth plan's total-return series". */
        via,
        /** true ⇒ a real split was rescaled out of the series (mf-split-adjust.ts). */
        splitAdjusted,
        schemeName: chart.schemeName, // the DRAWN series' name
        from: chart.from,
        to: chart.to,
        points,
        source: chart.source,
        /** Transient by design — Option B keeps no NAV history. Say so, so nobody assumes a cache. */
        stored: false,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /api/v1/mf/:schemeCode/family ────────────────────────
// Step 16's `mf_families` / `mf_family_members` were written for the fund-detail page's plan
// selector and had no read path at all until now — every other consumer is a batch script.
// This is a pure join over tables the derive job already owns: no new grouping logic, no write.
//
// `measurable` mirrors what /chart and /analytics already decide (`seriesSchemeCode !== null`)
// rather than re-deriving it — a member is "the plan that can be measured" by the exact same test
// the metrics endpoint used, not a second opinion that could drift from it.
export const getFundFamily = async (req: Request, res: Response) => {
  try {
    const schemeCode = String(req.params.schemeCode ?? "");
    if (!/^\d+$/.test(schemeCode)) {
      return res.status(400).json({ success: false, error: "Invalid scheme code" });
    }

    const membership = await prisma.mfFamilyMember.findUnique({ where: { schemeCode } });
    if (!membership) {
      return res.status(404).json({
        success: false,
        error: "This scheme has no derived family yet",
        detail: "Family grouping (mf_families) runs as a separate batch job; a very recently listed scheme can lag it.",
      });
    }

    const family = await prisma.mfFamily.findUnique({
      where: { id: membership.familyId },
      include: { members: true },
    });
    if (!family) {
      return res.status(404).json({ success: false, error: "Family not found" });
    }

    const codes = family.members.map((m) => m.schemeCode);
    const [instruments, analyticsRows] = await Promise.all([
      prisma.instrument.findMany({
        where: { amfiSchemeCode: { in: codes }, assetClass: { in: ["mutual_fund", "etf"] } },
        select: {
          amfiSchemeCode: true, symbol: true, assetClass: true, category: true, planType: true,
          currentNav: true, navDate: true, isActive: true,
        },
      }),
      prisma.mfAnalytics.findMany({
        where: { schemeCode: { in: codes } },
        select: { schemeCode: true, seriesSchemeCode: true },
      }),
    ]);

    // amfiSchemeCode is non-unique (up to 2 ISINs share a code) — either row describes the same
    // NAV/identity, so first-wins is fine; see Instrument.amfiSchemeCode's doc comment.
    const instByCode = new Map(instruments.map((i) => [i.amfiSchemeCode as string, i]));
    const analyticsByCode = new Map(analyticsRows.map((a) => [a.schemeCode, a]));

    const members = family.members.map((m) => {
      const inst = instByCode.get(m.schemeCode) ?? null;
      // Same fallback rule as the fold's own loadPlanMap: the normalised token first, AMFI's raw
      // name second — never "unknown" when the name itself says "Growth" in plain words.
      const { tier, isGrowth } = classifyPlanOption(m.planOption || m.schemeName);
      const optionLabel: "growth" | "bonus" | "idcw" = isGrowth
        ? "growth"
        : /\bbonus\b/i.test(m.planOption || m.schemeName)
          ? "bonus"
          : "idcw";
      const analytics = analyticsByCode.get(m.schemeCode) ?? null;

      return {
        schemeCode: m.schemeCode,
        schemeName: m.schemeName,
        planOption: m.planOption,
        tier,
        optionLabel,
        instrument: inst
          ? {
              symbol: inst.symbol,
              assetClass: inst.assetClass,
              category: inst.category,
              categoryLeaf: normaliseCategory(inst.category),
              planType: inst.planType,
              currentNav: inst.currentNav,
              navDate: inst.navDate,
              isActive: inst.isActive,
            }
          : null,
        hasAnalytics: analytics !== null,
        measurable: analytics !== null && analytics.seriesSchemeCode !== null,
      };
    });

    // ONE HOME for the fallback chain (Direct+Growth → Regular+Growth → any measurable → first) —
    // see mf-representative.ts. GET /api/v1/funds calls the exact same function, never a second copy.
    const representative = resolveRepresentative(members);

    return res.json({
      success: true,
      data: {
        schemeCode,
        family: {
          id: family.id,
          canonicalName: family.canonicalName,
          fundHouse: family.fundHouse,
          assetClass: family.assetClass,
          schemeCount: family.schemeCount,
          isSingleton: family.isSingleton,
          ungroupedReason: family.ungroupedReason,
        },
        /** The member `/research/funds` should show by default — resolved server-side so the
         *  detail page and the browse list can never disagree about whose numbers "the fund's
         *  return" means. */
        representativeSchemeCode: representative?.schemeCode ?? null,
        members,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── GET /api/v1/mf/run-logs ──────────────────────────────────
export const getMfRunLogs = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 30), 200);
    const job = req.query.job ? String(req.query.job) : undefined;

    const logs = await prisma.mfFetchLog.findMany({
      where: job ? { job } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ── POST /api/v1/admin/mf/nav/trigger ────────────────────────
export const triggerMfNavIngest = async (_req: Request, res: Response) => {
  const job = await enqueueJob({
    type: JobTypes.AMFI_NAV_DAILY,
    payload: {},
    triggeredBy: "user:admin",
  });
  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: "AMFI NAV ingest enqueued (one file, whole MF universe). Poll the status URL.",
    },
  });
};

// ── POST /api/v1/admin/mf/etf-nav/trigger ────────────────────
// The ETF identity/NAV pass (Step 13). Same AMFI file as the MF lane, the COMPLEMENTARY sections —
// which is exactly why it lives on the mutual-funds card and not one of its own: an ETF is an
// AMFI-registered fund whose analytics come out of the same fold.
//
// It had no manual trigger until now, which made it a MYSTERY CRON in every sense that matters: it
// ran nightly, and an operator could neither run it on demand nor watch it do so.
export const triggerEtfNavIngest = async (_req: Request, res: Response) => {
  const job = await enqueueJob({
    type: JobTypes.ETF_NAV_DAILY,
    payload: {},
    triggeredBy: "user:admin",
  });
  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: "ETF NAV/identity ingest enqueued (the AMFI file's ETF sections). Poll the status URL.",
    },
  });
};

// ── POST /api/v1/admin/mf/etf-prices/trigger ─────────────────
// The ETF EXCHANGE CLOSE (Step 14.5) — what a listed fund actually TRADES at, from the NSE udiff
// BhavCopy. A different number from the NAV and a different source, on the same instrument.
export const triggerEtfPricesIngest = async (_req: Request, res: Response) => {
  const job = await enqueueJob({
    type: JobTypes.ETF_PRICES_DAILY,
    payload: {},
    triggeredBy: "user:admin",
  });
  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: "ETF exchange-close ingest enqueued (NSE udiff BhavCopy). Poll the status URL.",
    },
  });
};

// ── POST /api/v1/admin/mf/analytics/trigger ──────────────────
export const triggerMfAnalytics = async (_req: Request, res: Response) => {
  const job = await enqueueJob({
    type: JobTypes.MF_ANALYTICS_DAILY,
    payload: {},
    triggeredBy: "user:admin",
  });
  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message:
        "MF analytics fold enqueued (~21 windows, ~12 min). Streams 5 years of NAV history, " +
        "computes analytics in memory, discards the raw NAV. Poll the status URL.",
    },
  });
};

// (REMOVED: POST /api/v1/admin/mf/inception-walk — the one-time earliest-NAV walk. It existed only
// to anchor ret_since_earliest_cagr, and that metric is gone: AMFI's raw NAV is neither
// split-adjusted nor total-return, so the further back the anchor the more corrupt the CAGR. The
// route, its handler, its job type and its columns are all removed.)

// ── POST /api/v1/admin/mf/corporate-actions/trigger ──────────
// Body: { symbols?: ["NIFTYBEES", …] }  — omit to sweep the whole ETF universe.
//
// THIS SHIPPED CRON-ONLY, AND THAT WAS THE BUG THIS HOUSE ALREADY FIXED ONCE. It runs at 19:45,
// fifteen minutes before the analytics fold, and it decides whether the fold's ETF numbers are RIGHT:
// it reads NSE's real, dated unit splits so the series can be rescaled before anything is folded from
// it. A job that silently decides the correctness of another job's output, with no card and no manual
// trigger, is exactly the "mystery cron" Step 10 went back and eliminated for amfi_nav_daily.
export const triggerInstrumentCorporateActions = async (req: Request, res: Response) => {
  const raw = req.body?.symbols;
  let symbols: string[] | undefined;
  if (raw !== undefined) {
    if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string" || !s.trim())) {
      return res.status(400).json({ success: false, error: "symbols must be a non-empty array of tickers" });
    }
    symbols = raw.map((s: string) => s.trim().toUpperCase());
  }

  const job = await enqueueJob({
    type: JobTypes.INSTRUMENT_CORPORATE_ACTIONS,
    payload: symbols ? { symbols } : {},
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message:
        (symbols
          ? `ETF corporate-actions sweep enqueued for ${symbols.length} symbol(s). `
          : "ETF corporate-actions sweep enqueued (327 NSE calls, ~15 min). ") +
        "Reads NSE's REAL, dated unit splits and reconciles the day AMFI applied each one, so the " +
        "nightly fold can rescale the NAV series before it computes anything. Idempotent. " +
        "Poll the status URL.",
    },
  });
};
