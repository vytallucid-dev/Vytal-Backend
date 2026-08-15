// ─────────────────────────────────────────────────────────────
// THE RISK-FREE LEG for Sharpe / Sortino (RULING ③).
//
// It already exists. index_prices carries "Nifty 1D Rate Index" (the overnight/TREPS index
// Indian AMC factsheets conventionally use) and "Nifty 10 yr Benchmark G-Sec". No new
// pipeline, no new source, no fabricated constant.
//
// THESE ARE TOTAL-RETURN INDICES, NOT SPOT YIELDS — and that is the RIGHT input. Sharpe's
// numerator is (fund return − risk-free return) OVER THE SAME WINDOW. What you want is the
// return actually EARNED risk-free across that window, which is precisely the index's own
// return. A spot yield quoted today says nothing about what cash earned over the last 3 years.
//
// ⚠️  THE DEPTH GATE — THE DOCTRINE STANDS, THE NUMBERS BELOW WERE STALE (corrected 2026-08-14).
//     The rule is unchanged and non-negotiable: a horizon the series does not cover is
//     honest-empty — NOT approximated, NOT back-filled with a constant, NOT silently annualised
//     from a shorter span. A Sharpe computed against a risk-free rate we do not have would be a
//     fabricated number wearing a decimal point. What follows is only the measured state.
//
//     THIS COMMENT USED TO SAY "index_prices holds only ~1 year of these indices today (recon:
//     ~250 points), so rf(3Y)/rf(5Y) DO NOT EXIST". That is no longer the case. Measured
//     2026-08-14: "Nifty 1D Rate Index" holds 1,233 points spanning 1,856 days
//     (2021-07-14 → 2026-08-13); "Nifty 10 yr Benchmark G-Sec" is identical. 1,856 > H.y5
//     (1,826), so y1/y3/y5 are all covered and the 3Y/5Y legs compute. Re-measure rather than
//     trusting this paragraph — depth moves.
//
//     ⚠ AND THE OLD PRESCRIBED FIX WAS UNRUNNABLE. It read "re-run INDEX_PRICES_BACKFILL with
//     days=1825", but IndexBackfillSchema (schema/schema.ts:73) is
//     `days: z.number().int().min(1).max(365)` — that request is rejected 400 by
//     controllers/ingestion/indices-controllers.ts:171. runIndexBackfill's own default
//     (ingest-indices.ts:325) is 365 too. The NSE index pipeline cannot reach past one year.
//     The depth above did NOT come from that path: it came from scripts/backfill-index-yahoo.ts,
//     a Yahoo-sourced 5yr backfill that writes the same index_prices.indexName series with
//     provider "yahoo-finance" (createMany skipDuplicates, never overwriting NSE rows). That
//     script is the actual deep-history route; raising the 365 cap is a separate, untaken decision.
//
// THIS IS ONE OF TWO INDEPENDENT GATES. A Sharpe needs BOTH (i) the fund's own NAV depth and
// (ii) the risk-free series covering that horizon. Either one missing ⇒ honest-empty, with
// the reason recorded so the two cases are distinguishable in the ledger.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { H, ANCHOR_TOLERANCE_DAYS } from "./mf-accumulator.js";

/** Preference order. The 1D-Rate index is the factsheet convention; the G-Sec is the fallback. */
const RF_INDICES = ["Nifty 1D Rate Index", "Nifty 10 yr Benchmark G-Sec"] as const;

export type RfHorizon = "y1" | "y3" | "y5";

export interface RiskFree {
  /** The index actually used, for provenance on the API response. */
  indexName: string | null;
  /** Annualised risk-free return per horizon — null when the series does not cover it. */
  rate: Record<RfHorizon, number | null>;
  /** Why a horizon is null (lands in the omissions ledger). */
  reason: Record<RfHorizon, string | null>;
  /** Depth of the series actually found, for the run log. */
  points: number;
  spanDays: number;
}

/**
 * Build the risk-free legs as of `asOfDay` (a day-number).
 *
 * Computed ONCE per run, not per fund — it is the same number for all 13,704 schemes.
 */
export async function loadRiskFree(asOfDay: number): Promise<RiskFree> {
  const out: RiskFree = {
    indexName: null,
    rate: { y1: null, y3: null, y5: null },
    reason: { y1: null, y3: null, y5: null },
    points: 0,
    spanDays: 0,
  };

  for (const name of RF_INDICES) {
    const rows = await prisma.indexPrice.findMany({
      where: { indexName: name },
      orderBy: { date: "asc" },
      select: { date: true, close: true },
    });
    if (rows.length < 2) continue;

    const series = rows.map((r) => ({
      day: Math.floor(r.date.getTime() / 86_400_000),
      close: Number(r.close),
    }));
    out.indexName = name;
    out.points = series.length;
    out.spanDays = series[series.length - 1]!.day - series[0]!.day;

    const endIdx = lastOnOrBefore(series, asOfDay);
    if (endIdx < 0) {
      for (const h of ["y1", "y3", "y5"] as RfHorizon[]) {
        out.reason[h] = `risk_free_index_has_no_value_on_or_before_as_of_date (${name})`;
      }
      return out;
    }
    const end = series[endIdx]!;

    for (const h of ["y1", "y3", "y5"] as RfHorizon[]) {
      const targetDay = asOfDay - H[h];
      const startIdx = firstOnOrAfter(series, targetDay);

      // The series must actually REACH back to the anchor. If its oldest point is later than
      // the anchor (by more than the shared tolerance), the horizon is simply not covered.
      if (startIdx < 0 || series[startIdx]!.day - targetDay > ANCHOR_TOLERANCE_DAYS) {
        const oldest = series[0]!.day;
        const haveYears = ((asOfDay - oldest) / 365.25).toFixed(1);
        out.reason[h] =
          `risk_free_series_too_short: "${name}" covers ${haveYears}y ` +
          `(${series.length} pts), needs ${(H[h] / 365.25).toFixed(0)}y`;
        continue;
      }

      const start = series[startIdx]!;
      if (start.close <= 0 || end.close <= 0) {
        out.reason[h] = `risk_free_index_non_positive_close (${name})`;
        continue;
      }
      const years = (end.day - start.day) / 365.25;
      if (years <= 0.5) {
        out.reason[h] = `risk_free_span_too_short_to_annualise (${years.toFixed(2)}y)`;
        continue;
      }
      // Annualised total return of the risk-free index across exactly this window.
      out.rate[h] = Math.pow(end.close / start.close, 1 / years) - 1;
    }

    return out; // first index with usable data wins
  }

  for (const h of ["y1", "y3", "y5"] as RfHorizon[]) {
    out.reason[h] = "risk_free_index_absent: no G-Sec / 1D-Rate series in index_prices";
  }
  return out;
}

function lastOnOrBefore(s: { day: number }[], day: number): number {
  let lo = 0, hi = s.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.day <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function firstOnOrAfter(s: { day: number }[], day: number): number {
  let lo = 0, hi = s.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.day >= day) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}
