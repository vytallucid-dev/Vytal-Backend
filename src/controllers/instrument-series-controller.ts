// File: src/controllers/instrument-series-controller.ts
// ─────────────────────────────────────────────────────────────────────────────
// GENERAL PER-INSTRUMENT STORED SERIES — GET /api/v1/instruments/:instrumentId/series?days=<n>
//
//   → { success, data: { instrumentId, points:[{date,value}], source, from, to, resolution, coverage } }
//
// Reads `instrument_price_history` ONLY — the weekly sample (nav_corrected | market_close), 4-year
// rolling. NEVER mfapi, NEVER the live /mf/:schemeCode/chart, NEVER a fallback: keeping a
// high-frequency UI surface (the holdings sparkline) off an unmetered external API is the ENTIRE
// point of reading the stored table. The live chart stays for the once-per-visit fund detail page.
//
// WHAT LIVES HERE, AND WHAT DOES NOT (the stock/fund boundary — do not cross it):
//   `instrument_price_history` holds NON-STOCK series only — funds/ETFs (nav_corrected) and listed
//   non-stocks (bond/gsec/sgb/reit/invit, market_close). STOCKS are charted from `daily_prices` (the
//   OHLCV path) and are deliberately NOT stored here (enqueue-backfill.ts: "stocks use daily_prices;
//   nothing to store here"). So a STOCK instrumentId hitting this endpoint simply has zero rows →
//   coverage:"none"; the frontend keeps using the existing OHLCV hook for stocks. This endpoint
//   serves whatever is stored; it does not reach into daily_prices.
//
// HONEST STATES:
//   · unknown id                 → 404 (the instrument genuinely does not exist)
//   · known id, zero stored rows → 200 · points:[] · coverage:"none"  (backfill not run yet — a TRUE
//     state, "history is still building", NEVER a 404/503)
//   · known id, stored rows      → 200 · the series · coverage full|partial
// Public read, matching the fund analytics/chart reads (fund data is catalogue data, no auth).
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { readInstrumentSeries, type SeriesSource } from "../portfolio/history/series-store.js";

// Coverage thresholds — the series is WEEKLY, so a point count ≈ weeks of history. `full` means a
// window worth drawing a sparkline over; below it the history is thin/recent-only. Computed on the
// INSTRUMENT's full stored history (pre-`days`), so a narrow `?days` window can never downgrade it.
const FULL_MIN_POINTS = 26; // ≈ 6 months of weekly points

export const getInstrumentSeries = async (req: Request, res: Response) => {
  try {
    const instrumentId = String(req.params.instrumentId ?? "");
    const days = req.query.days !== undefined ? Number(req.query.days) : undefined;
    if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
      return res.status(400).json({ success: false, error: "days must be a positive number" });
    }

    // A garbage id is genuinely unknown → 404. A KNOWN instrument with no stored rows is a DIFFERENT,
    // true state (backfill not run) and must NOT 404 — see the header.
    const instr = await prisma.instrument.findUnique({ where: { id: instrumentId }, select: { id: true } });
    if (!instr) {
      return res.status(404).json({ success: false, error: "Unknown instrument" });
    }

    const all = await readInstrumentSeries(prisma, instrumentId);

    // Coverage describes the instrument's STORED history (pre-trim).
    const coverage: "full" | "partial" | "none" =
      all.length === 0 ? "none" : all.length >= FULL_MIN_POINTS ? "full" : "partial";

    // `?days` trims the RETURNED window (post-coverage), mirroring the fund chart's param. Weekly dates
    // are date-only; compare at UTC midnight.
    const cutoff = days !== undefined ? Date.now() - days * 86_400_000 : null;
    const points =
      cutoff == null ? all : all.filter((p) => new Date(`${p.date}T00:00:00Z`).getTime() >= cutoff);

    // One source normally (a fund → nav_corrected, a listed instrument → market_close); `mixed` is
    // defensive. `null` when the window is empty — there is no source to name.
    const sources = new Set(points.map((p) => p.source));
    const source: SeriesSource | "mixed" | null =
      points.length === 0 ? null : sources.size > 1 ? "mixed" : (points[0]!.source as SeriesSource);

    return res.json({
      success: true,
      data: {
        instrumentId,
        points: points.map((p) => ({ date: p.date, value: p.value })),
        source,
        from: points[0]?.date ?? null,
        to: points[points.length - 1]?.date ?? null,
        resolution: "weekly" as const,
        coverage,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};
