// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO BENCHMARK — the index series the value chart overlays (rebased to 100
// client-side). READ-ONLY over index_prices; no compute, no store.
//
//   GET /api/v1/me/portfolio/benchmark              full Nifty 50 series {date,close}[]
//   GET /api/v1/me/portfolio/benchmark?period=1Y    tail-sliced to the period
//   GET /api/v1/me/portfolio/benchmark?from=YYYY-MM-DD   from a date forward
//   GET /api/v1/me/portfolio/benchmark?accountId=…  the SAME series, for an account chart's overlay
//
// Nifty 50 ONLY for now (the portfolio benchmark). The table holds many indices, but
// this portfolio-scoped read serves just the benchmark — a safelist keeps it from
// exposing the whole catalogue. No Sensex (BSE) — this is an NSE feed. The frontend
// aligns (carry-forward) + rebases; here we only serve the raw closes.
//
// ── ACCOUNT SCOPE ────────────────────────────────────────────────────────────────────────────────
// The benchmark is the SAME index series whatever the scope — an account chart overlays the same
// Nifty 50, and the frontend pairs it with the ACCOUNT's value/TWR line (aligning to that account's
// dates). So `accountId` does not change the data; it is accepted and VALIDATED as the caller's own
// (404 on a foreign/unknown id) purely so the account chart's overlay request is IDOR-safe and
// per-account-consistent with its nav/twr siblings. Omitted ⇒ whole-book, identical to today.
//
// Mounted behind requireAuth with the rest of /me/*; the index data itself is public
// market data, but the endpoint lives on the (already-authed) portfolio surface.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { resolveAccountScope } from "./account-scope.js";

const DEFAULT_INDEX = "Nifty 50";
// Only the portfolio benchmark is reachable here (extend deliberately, never open-ended).
const ALLOWED_INDICES = new Set<string>(["Nifty 50"]);

const PERIOD_DAYS: Record<string, number | null> = {
  "1M": 30,
  "6M": 182,
  "1Y": 365,
  "3Y": 1095,
  "4Y": 1461, // the blended-chart ceiling (R6) — the frontend requests this to match a fund/blended NAV window
  ALL: null,
};

export const getPortfolioBenchmark = async (req: Request, res: Response) => {
  // Validate an optional account scope (IDOR-safe: a foreign/unknown id 404s). The series is
  // unchanged by it — the overlay is the same benchmark — but the account chart's request is
  // validated exactly like its nav/twr siblings, and the scope is echoed in meta.
  const scope = await resolveAccountScope(req, res);
  if (!scope.ok) return;
  const accountId = scope.accountId;

  const requestedIndex = String(req.query.index ?? DEFAULT_INDEX);
  const indexName = ALLOWED_INDICES.has(requestedIndex) ? requestedIndex : DEFAULT_INDEX;

  const requestedPeriod = String(req.query.period ?? "ALL").toUpperCase();
  const period = requestedPeriod in PERIOD_DAYS ? requestedPeriod : "ALL";

  const fromRaw = req.query.from ? String(req.query.from) : null;
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : null;

  try {
    const rows = await prisma.indexPrice.findMany({
      where: { indexName, ...(from ? { date: { gte: new Date(from) } } : {}) },
      orderBy: { date: "asc" },
      select: { date: true, close: true },
    });
    let series = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), close: Number(r.close) }));

    // Optional server-side tail slice (the frontend fetches ALL and slices client-side to
    // match the visible NAV window, so it can carry-forward + rebase — this is just symmetry
    // with the NAV endpoint).
    const windowDays = PERIOD_DAYS[period];
    if (windowDays != null && series.length > 0) {
      const last = new Date(series[series.length - 1].date);
      const cutoff = new Date(last);
      cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      series = series.filter((p) => p.date >= cutoffStr);
    }

    return res.json({
      success: true,
      data: {
        series, // [{ date, close }] — index EOD closes
        meta: {
          indexName,
          accountId: accountId ?? null, // the scope this overlay is FOR (null ⇒ whole book) — additive
          period,
          firstDate: series[0]?.date ?? null,
          lastDate: series[series.length - 1]?.date ?? null,
          points: series.length,
          basis: "eod_close",
        },
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio/benchmark]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load the benchmark series" });
  }
};
