// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY-SERIES BACKFILL ORCHESTRATION (Step 21) — one instrument, or the whole held book.
//
// Routes each held non-stock instrument to the right source (mirroring price-resolver.ts, so the
// chart's history and the overview's live number agree on how a thing is priced):
//   · mutual_fund               → fund-series (mfapi NAV, corrected)         source=nav_corrected
//   · etf, listed (last_price)  → listed-series (udiff close)                source=market_close
//   · etf, unlisted (NAV only)  → fund-series (mfapi NAV, corrected)         source=nav_corrected
//   · bond/gsec/sgb/reit/invit  → listed-series (udiff close)                source=market_close
//
// Every step reports progress so a stuck run is visible (heartbeat via reportProgress). The result
// summary names every instrument's outcome — points stored, or the honest reason it has no series.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { loadPlanMap } from "../../ingestions/amfi/mf-distributions.js";
import { resolveFundSeries, buildGrowthIndex } from "./fund-series.js";
import { weeklySampleDates, fetchUdiffWeekCloses } from "./listed-series.js";
import { sampleWeekly } from "./weekly-sample.js";
import { persistWeeklySeries } from "./series-store.js";

export interface BackfillTarget {
  instrumentId: string;
  isin: string;
  assetClass: string;
  amfiSchemeCode: string | null;
  hasLastPrice: boolean;
}

export interface InstrumentOutcome {
  instrumentId: string;
  assetClass: string;
  source: "nav_corrected" | "market_close" | null;
  pointsStored: number;
  /** null ⇔ charted. Otherwise the honest reason it has no series (mirrors excludedFromSeries). */
  reason: string | null;
  via?: string;
}

export interface BackfillReport {
  targets: number;
  charted: number;
  excluded: number;
  pointsStored: number;
  outcomes: InstrumentOutcome[];
}

type Report = (percent: number, note: string) => Promise<void>;
const noop: Report = async () => {};

/** Load the catalogue facts the router needs for a set of instruments. */
export async function loadTargets(instrumentIds: string[]): Promise<BackfillTarget[]> {
  const rows = await prisma.instrument.findMany({
    where: { id: { in: instrumentIds } },
    select: { id: true, isin: true, assetClass: true, amfiSchemeCode: true, lastPrice: true },
  });
  return rows.map((r) => ({
    instrumentId: r.id,
    isin: r.isin,
    assetClass: r.assetClass,
    amfiSchemeCode: r.amfiSchemeCode,
    hasLastPrice: r.lastPrice != null,
  }));
}

/** Every NON-STOCK instrument currently net-held (qty > 0) by any user — the refresh demand set. */
export async function heldNonStockInstrumentIds(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ instrument_id: string }[]>(`
    WITH pos AS (
      SELECT t.instrument_id,
             SUM(CASE WHEN t.type='buy' THEN COALESCE(t.quantity,0)
                      WHEN t.type='sell' THEN -COALESCE(t.quantity,0) ELSE 0 END) AS net_qty
      FROM transactions t GROUP BY t.instrument_id)
    SELECT p.instrument_id FROM pos p
    JOIN instruments i ON i.id = p.instrument_id
    WHERE p.net_qty > 0 AND i.asset_class <> 'stock'`);
  return rows.map((r) => r.instrument_id);
}

/** Does this target take the exchange-close (udiff) path, or the NAV (mfapi) path? Mirrors the resolver. */
function isListedPath(t: BackfillTarget): boolean {
  if (t.assetClass === "mutual_fund") return false; // funds never trade
  if (t.assetClass === "etf") return t.hasLastPrice; // listed ETF → close; unlisted ETF → NAV
  return true; // bond/gsec/sgb/reit/invit are exchange-traded
}

/**
 * Backfill (or refresh) the weekly series for a set of instruments. Idempotent — persists only new
 * weeks; the DB trigger keeps each instrument to 4y. `report` is the heartbeat.
 */
export async function runBackfill(
  targets: BackfillTarget[],
  opts: { report?: Report; signal?: AbortSignal } = {},
): Promise<BackfillReport> {
  const report = opts.report ?? noop;
  const todayIso = new Date().toISOString().slice(0, 10);
  const outcomes: InstrumentOutcome[] = [];

  const funds = targets.filter((t) => !isListedPath(t));
  const listed = targets.filter((t) => isListedPath(t));

  // ── FUNDS (mfapi, corrected). Plan map + growth index loaded ONCE for the whole batch. ──
  if (funds.length > 0) {
    const planMap = await loadPlanMap();
    const growthIndex = buildGrowthIndex(planMap);
    for (let i = 0; i < funds.length; i++) {
      const t = funds[i];
      await report(Math.round((i / targets.length) * 100), `fund ${i + 1}/${funds.length} (${t.assetClass})`);
      const r = await resolveFundSeries(t.instrumentId, { planMap, growthIndex, signal: opts.signal });
      if (!r.ok) {
        outcomes.push({ instrumentId: t.instrumentId, assetClass: t.assetClass, source: null, pointsStored: 0, reason: r.reason });
        continue;
      }
      const n = await persistWeeklySeries(prisma, t.instrumentId, r.points, "nav_corrected");
      outcomes.push({ instrumentId: t.instrumentId, assetClass: t.assetClass, source: "nav_corrected", pointsStored: n, reason: null, via: r.via });
    }
  }

  // ── LISTED (udiff). ONE archive pass over all wanted ISINs, then fan out. ──
  if (listed.length > 0) {
    const isinToId = new Map(listed.map((t) => [t.isin, t.instrumentId] as const));
    const wanted = new Set(isinToId.keys());
    const weekDates = weeklySampleDates(todayIso);
    const base = funds.length; // progress offset
    const closesByIsin = await fetchUdiffWeekCloses(wanted, weekDates, {
      signal: opts.signal,
      onWeek: (p) =>
        void report(
          Math.round(((base + (listed.length * p.index) / p.total) / targets.length) * 100),
          `udiff week ${p.index}/${p.total} (${p.date} ${p.status})`,
        ),
    });
    for (const t of listed) {
      const raw = closesByIsin.get(t.isin) ?? [];
      const pts = raw.length > 0 ? sampleWeekly(raw, raw[raw.length - 1].date, 4) : [];
      if (pts.length === 0) {
        outcomes.push({ instrumentId: t.instrumentId, assetClass: t.assetClass, source: null, pointsStored: 0, reason: "not_exchange_traded" });
        continue;
      }
      const n = await persistWeeklySeries(prisma, t.instrumentId, pts, "market_close");
      outcomes.push({ instrumentId: t.instrumentId, assetClass: t.assetClass, source: "market_close", pointsStored: n, reason: null });
    }
  }

  await report(100, "done");
  const charted = outcomes.filter((o) => o.reason === null).length;
  return {
    targets: targets.length,
    charted,
    excluded: outcomes.length - charted,
    pointsStored: outcomes.reduce((s, o) => s + o.pointsStored, 0),
    outcomes,
  };
}
