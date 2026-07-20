// ─────────────────────────────────────────────────────────────────────────────
// FUND / UNLISTED-ETF SERIES SOURCE (Step 21) — one held fund → its CORRECTED weekly series.
//
// SOURCE: mfapi (one call, ~130 KB — mf-chart.fetchFundChart), then the SAME split-rescale the
// nightly fold applies (Step 19), then weekly-sample the last 4 years. The result is byte-identical
// to what the fold would persist — same raw NAVs (mfapi agrees with AMFI per mf-chart recon), same
// dated splits, same formula — so "chart and metrics off the same corrected series" holds (R3).
//
// IDCW REDIRECT (Ruling B): an IDCW plan's own NAV sawtooths on every payout. Its total-return
// series IS its tier-matched Growth twin's NAV (Direct↔Direct, Regular↔Regular). So a held IDCW
// plan is charted from its twin's series — the chart inherits EXACTLY where mf-distributions.ts
// makes the METRIC inherit, and is EXCLUDED exactly where the metric honest-NULLs (a twinless
// IDCW-only family, or two live twins that disagree — we refuse to coin-flip).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { fetchFundChart } from "../../ingestions/amfi/mf-chart.js";
import { loadPlanMap, type PlanInfo } from "../../ingestions/amfi/mf-distributions.js";
import { loadSplitsForScheme } from "../../ingestions/amfi/mf-splits-source.js";
import { rescaleForSplits, sampleWeekly, type SeriesPoint } from "./weekly-sample.js";

export type FundSeriesResult =
  | { ok: true; seriesCode: string; via: "self" | "growth_twin"; points: SeriesPoint[] }
  | { ok: false; reason: FundSeriesUnavailable };

/** Why a held fund has no chartable series. Mirrors the metric-level honest-null reasons. */
export type FundSeriesUnavailable =
  | "no_scheme_code" // not an AMFI fund/ETF (shouldn't reach here)
  | "idcw_no_twin" // IDCW-only family — no Growth sibling to inherit from (708 families)
  | "idcw_ambiguous_twin" // two live Growth twins disagree — refuse to choose (as the metric does)
  | "source_empty" // brand-new fund, genuinely no history yet (honest-empty, not an error)
  | "source_unreachable"; // mfapi down / scheme unknown — a fault, retried by the job

interface Ctx {
  /** Preloaded plan map (the weekly refresh loads it ONCE for all held funds); else loaded here. */
  planMap?: Map<string, PlanInfo>;
  /** Preloaded growth-by-(family|tier) index — codes of every Growth plan in a tier. */
  growthIndex?: Map<string, string[]>;
  signal?: AbortSignal;
}

/** Build the "(familyId|tier) → [growth scheme codes]" index once, for twin resolution. */
export function buildGrowthIndex(planMap: Map<string, PlanInfo>): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const [code, p] of planMap) {
    if (!p.isGrowth) continue;
    const key = `${p.familyId}|${p.tier}`;
    const list = idx.get(key) ?? [];
    list.push(code);
    idx.set(key, list);
  }
  return idx;
}

/** Fetch + correct + weekly-sample one scheme code. Shared by the self and twin branches. */
async function correctedWeekly(seriesCode: string, signal?: AbortSignal): Promise<SeriesPoint[] | null> {
  const chart = await fetchFundChart(seriesCode); // fetchFundChart handles its own timeout
  if (signal?.aborted) throw new Error("aborted");
  if (!chart.ok) return null; // source unreachable / unknown scheme
  if (chart.points.length === 0) return []; // honest-empty
  const raw: SeriesPoint[] = chart.points.map((p) => ({ date: p.date, value: Number(p.nav) }));
  const splits = await loadSplitsForScheme(seriesCode);
  const corrected = rescaleForSplits(raw, splits);
  const asOf = corrected[corrected.length - 1].date; // anchor on the fund's OWN latest NAV
  return sampleWeekly(corrected, asOf, 4);
}

/**
 * Resolve one held fund/unlisted-ETF instrument to its corrected weekly series (last 4y).
 * `assetClass` and `amfiSchemeCode` are read from the catalogue.
 */
export async function resolveFundSeries(instrumentId: string, ctx: Ctx = {}): Promise<FundSeriesResult> {
  const inst = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    select: { amfiSchemeCode: true, assetClass: true },
  });
  if (!inst?.amfiSchemeCode) return { ok: false, reason: "no_scheme_code" };
  const ownCode = inst.amfiSchemeCode;

  // ── Which scheme's series do we actually chart? ──
  // ETFs have no plan structure → always self. Mutual funds: Growth/plain → self; IDCW → twin.
  let seriesCode = ownCode;
  let via: "self" | "growth_twin" = "self";

  if (inst.assetClass === "mutual_fund") {
    const planMap = ctx.planMap ?? (await loadPlanMap());
    const plan = planMap.get(ownCode);
    if (plan && !plan.isGrowth) {
      const growthIndex = ctx.growthIndex ?? buildGrowthIndex(planMap);
      const twins = growthIndex.get(`${plan.familyId}|${plan.tier}`) ?? [];
      if (twins.length === 0) return { ok: false, reason: "idcw_no_twin" };
      if (twins.length === 1) {
        seriesCode = twins[0];
        via = "growth_twin";
      } else {
        // More than one Growth code in the tier. Keep only those with a live series, then refuse
        // to choose between survivors — the same "ambiguous twins" boundary the metric draws.
        const live: { code: string; pts: SeriesPoint[] }[] = [];
        for (const c of twins) {
          const pts = await correctedWeekly(c, ctx.signal);
          if (pts && pts.length > 0) live.push({ code: c, pts });
        }
        if (live.length === 0) return { ok: false, reason: "idcw_no_twin" };
        if (live.length > 1) return { ok: false, reason: "idcw_ambiguous_twin" };
        return { ok: true, seriesCode: live[0].code, via: "growth_twin", points: live[0].pts };
      }
    }
  }

  const pts = await correctedWeekly(seriesCode, ctx.signal);
  if (pts === null) return { ok: false, reason: "source_unreachable" };
  if (pts.length === 0) return { ok: false, reason: "source_empty" };
  return { ok: true, seriesCode, via, points: pts };
}
