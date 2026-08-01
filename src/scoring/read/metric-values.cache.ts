// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// METRIC RAW VALUES ACROSS THE UNIVERSE — one read, cached, stale-while-revalidate.
//
// The cached UniverseHealthView carries composites, pillars, bands, sectors and fired findings, so
// every score-level and structural filter is free. It carries NO metric values. This is the one extra
// round trip a numeric screen needs, and this module is all of it.
//
// ── ★ ONE READ FOR ALL KEYS, NEVER ONE PER CONDITION ───────────────────────────────────────────────
// Measured on the live universe: the whole score_metrics fetch for all 188 foundation+momentum pillar
// rows is 1,127 rows in 244ms cold / 86ms warm, against 121ms for a SINGLE key. Two single-key reads
// already cost more than fetching everything, and a three-condition screen would pay three round trips
// for no gain. So the loader takes no key argument — it cannot be called per-condition.
// `score_metrics` carries @@index([metricKey, scoreState]) commented "universe metric scans"; this read
// was anticipated by the schema.
//
// ── ★ THE SAME CACHE POLICY AS universe-view.cache.ts, ON PURPOSE ──────────────────────────────────
// Same 5-minute TTL, same serve-stale-and-revalidate, same single-flight rebuild, same no-parameter
// signature — because it is the same data lifecycle. Metric rows change ON RESCORE, which is what the
// universe view is already cached against, and the two are read together in one turn. One cache
// pattern in the codebase means one failure mode to reason about (that file's words, and its point).
//
// ── ★ IT HOLDS PUBLIC PRODUCT DATA AND CANNOT BECOME USER-SCOPED ───────────────────────────────────
// Asserted by SHAPE: `getUniverseMetricValues()` TAKES NO ARGUMENTS. There is no key, no map, and
// nowhere a userId could enter. What it caches is raw metric figures that already appear on the stock
// page and in getStockFundamentals. The reader's own scope is applied AFTER this, in the pure filter,
// from symbols resolved out of ctx.userId. ⚠ Do not add a parameter to this function.
//
// ── ★ RAW VALUES ONLY — THE SELECT IS THE ENFORCEMENT ──────────────────────────────────────────────
// The query selects `rawValue` and does NOT select metricScore / l1Score / l2Score / l3Score / l1Band.
// A 0–100 metric score embeds peer μ/σ and own-history statistics published nowhere, so it leaks more
// than the L1 bars a reader can already see on the peer-group page. Withholding it in the SCHEMA would
// still leave it one property access away; withholding it in the SELECT means it is not in the process.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { resolveHeadSnapshots, splitByStaleness } from "./head-snapshot.js";

/** Serve-stale-and-revalidate boundary. Same five minutes as the universe view — see the header. */
export const METRIC_VALUES_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * symbol → (engine metric key → raw value). The engine key is INTERNAL and never leaves the read
 * layer: `screen.service.ts` resolves it through SCREEN_FIELDS and emits reader-facing labels only.
 */
export type UniverseMetricValues = ReadonlyMap<string, ReadonlyMap<string, number>>;

const num = (d: unknown): number =>
  d == null
    ? NaN
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);

/**
 * Load every scored foundation + momentum metric RAW value for the live cross-section.
 *
 * Resolves the head snapshot with the SHARED resolver (head-snapshot.ts), exactly as the universe view
 * does, so a stock's metrics and its score can never come from different snapshots. Two round trips:
 * the lean head resolution, then the metric rows for the resolved pillar ids.
 */
async function loadUniverseMetricValues(): Promise<UniverseMetricValues> {
  const lean = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: {
      stockId: true,
      symbol: true,
      periodKey: true,
      version: true,
      asOfDate: true,
      foundationPillarId: true,
      momentumPillarId: true,
    },
  });
  if (lean.length === 0) return new Map();

  const heads = resolveHeadSnapshots(lean);
  const { current } = splitByStaleness(heads.values());
  if (current.length === 0) return new Map();

  // pillar row id → symbol. Foundation and Momentum both point back to the same company.
  const symbolByPillarId = new Map<string, string>();
  for (const r of current) {
    symbolByPillarId.set(r.foundationPillarId, r.symbol);
    symbolByPillarId.set(r.momentumPillarId, r.symbol);
  }

  // ★ RAW ONLY. metricScore / l1Score / l2Score / l3Score / l1Band are deliberately not selected.
  // ★ scoreState is filtered to `scored`: suppressed / missing_renorm / neutral_hold rows carry a
  //   weight story, not a measurement the reader asked about. (Live today: every row is `scored`, so
  //   this changes nothing now and stays correct the first time one is not.)
  const rows = await prisma.metricScore.findMany({
    where: { pillarScoreId: { in: [...symbolByPillarId.keys()] }, scoreState: "scored" },
    select: { pillarScoreId: true, metricKey: true, rawValue: true },
  });

  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const symbol = symbolByPillarId.get(r.pillarScoreId);
    if (!symbol) continue;
    const v = num(r.rawValue);
    if (!Number.isFinite(v)) continue; // a non-finite raw value is not a measurement — omit, never zero
    const forSymbol = out.get(symbol) ?? new Map<string, number>();
    forSymbol.set(r.metricKey, v);
    out.set(symbol, forSymbol);
  }
  return out;
}

let cache: { values: UniverseMetricValues; builtAt: number } | null = null;
let rebuildInFlight: Promise<UniverseMetricValues> | null = null;

/** Start (or join) a rebuild. One in flight at a time — a burst of cold callers shares one load. */
function rebuild(): Promise<UniverseMetricValues> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = loadUniverseMetricValues()
    .then((values) => {
      cache = { values, builtAt: Date.now() };
      return values;
    })
    .finally(() => {
      rebuildInFlight = null;
    });
  return rebuildInFlight;
}

/**
 * The universe's metric raw values, cached. ★ NO PARAMETERS — see the header.
 *
 * Cold  → loads and waits (joining any load already running).
 * Warm  → returns the cached map.
 * Stale → returns the cached map NOW and reloads behind it.
 */
export async function getUniverseMetricValues(): Promise<UniverseMetricValues> {
  if (!cache) return rebuild();
  if (Date.now() - cache.builtAt > METRIC_VALUES_CACHE_TTL_MS) {
    // A failed background reload must not reject an already-answered request.
    rebuild().catch(() => {
      /* the last good map keeps serving; the next caller retries */
    });
  }
  return cache.values;
}

/** Observability for the verification harness. Carries no values. */
export function metricValuesCacheStats(): { warm: boolean; ageMs: number | null; rebuilding: boolean; companies: number } {
  return {
    warm: cache !== null,
    ageMs: cache ? Date.now() - cache.builtAt : null,
    rebuilding: rebuildInFlight !== null,
    companies: cache ? cache.values.size : 0,
  };
}

/** Test-only: drop the slot so a harness can measure a genuine cold path. Never called in product code. */
export function _clearMetricValuesCacheForVerification(): void {
  cache = null;
}

/** Test-only: backdate the slot so a harness can cross the TTL without waiting five minutes. */
export function _ageMetricValuesCacheForVerification(byMs: number): void {
  if (cache) cache = { ...cache, builtAt: cache.builtAt - byMs };
}
