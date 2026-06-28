// ─────────────────────────────────────────────────────────────
// FINANCIAL-INDUSTRY (banking / NBFC / LI / GI) detection guards.
//
// Reuses the Ind-AS predicates (shape/scale/continuity) and adds the
// per-industry invariants. Because the 8 industry ingesters are uniform,
// the SHAPE-reject and per-record-guard logic is centralised in two
// report helpers the ingesters call — keeping each ingester's edit tiny.
//
// Grounded vs real data: banking 16 stocks, NBFC 20, LI 4, GI 1.
//   - SHAPE/SCALE are universe-agnostic (a both-null P&L or a >1e7 value
//     is a break at any sample size) — real even for GI's single stock.
//   - Solvency floor is REGULATION-derived (IRDAI 1.5×), so <1.0 catches
//     CORRUPTION (real data has impossible 0.02/0.03) not DISTRESS.
//   - NNPA≤GNPA: 0 historical violations → clean invariant.
//   - NOT guarded: GNPA/CET1 null-rate (~70% null = normal sparse
//     disclosure), NBFC loans>0 (6/141 legit holding-NBFCs), disclosed
//     ratios (gnpaPct/cet1/combinedRatio/NIM — inherit trust from raws).
// ─────────────────────────────────────────────────────────────

import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  RESULTS_CRON,
  RESULTS_SOURCE,
  SCALE_CEIL_CR,
  REVENUE_YOY_MAX_PCT,
  checkPlContentless,
  checkScale,
  checkRevenueYoyAnomaly,
  resultsRunRef,
} from "./fundamentals-guards.js";

export { resultsRunRef };

// Solvency below this is physically impossible (real insurers ≥1.5× IRDAI
// floor); catches the 0.02/0.03 parse errors, not real-but-distressed firms.
export const SOLVENCY_MIN = 1.0;

// CASA / Tier-1 plausible bands (bank_supplementary manual entry). Grounded:
// real CASA [29.4, 51] ⊂ [15,60]; real Tier-1 [10.05, 17.7] ⊂ [5,25].
export const CASA_BAND: readonly [number, number] = [15, 60];
export const TIER1_BAND: readonly [number, number] = [5, 25];

// ── Predicates ───────────────────────────────────────────────

/** Banking — Net NPA cannot exceed Gross NPA. */
export function checkNpaHierarchy(
  nnpa: number | null,
  gnpa: number | null,
): boolean {
  return nnpa != null && gnpa != null && nnpa > gnpa;
}

/** Insurance — solvency implausibly low ⇒ corruption (not distress). */
export function checkSolvencyImplausible(solvency: number | null): boolean {
  return solvency != null && solvency < SOLVENCY_MIN;
}

/** Manual entry — value outside the metric's plausible band. */
export function checkBand(
  v: number | null,
  band: readonly [number, number],
): boolean {
  return v != null && (v < band[0] || v > band[1]);
}

// ── Shared report helpers (the 8 XBRL ingesters call these) ──

/**
 * GUARD 1 — SHAPE. If both core P&L lines are null, report critical +
 * return true so the caller returns `{status:"rejected"}` (no upsert).
 * Runs on every upsert (ingest + refresh) to protect existing rows.
 */
export async function financialShapeReject(o: {
  table: string;
  entity: string;
  runRef: string;
  coreA: number | null;
  coreB: number | null;
  coreLabel: string;
}): Promise<boolean> {
  if (!checkPlContentless(o.coreA, o.coreB)) return false;
  await reportIngestionError({
    source: RESULTS_SOURCE,
    cron: RESULTS_CRON,
    guardType: "shape",
    targetTable: o.table,
    targetEntity: o.entity,
    severity: "critical",
    resolutionPath: "source_code",
    expected: `${o.coreLabel} present`,
    observed: "both null (no P&L content)",
    detail:
      "Financial P&L tags did not resolve (likely an XBRL tag rename) — rejecting the upsert to preserve any existing row.",
    runRef: o.runRef,
  });
  return true;
}

/**
 * GUARDS 4 + 5 — per-record RANGE/scale + invariants + continuity. Caller
 * gates this on `decision === "ingest"` (genuinely new period only).
 */
export async function financialRecordGuards(o: {
  table: string;
  entity: string;
  runRef: string;
  scale: ReadonlyArray<readonly [string, number | null]>;
  yoy?: number | null;
  yoyLabel?: string;
  npa?: { nnpa: number | null; gnpa: number | null }; // banking only
  solvency?: number | null; // insurance only
}): Promise<void> {
  const base = {
    source: RESULTS_SOURCE,
    cron: RESULTS_CRON,
    targetTable: o.table,
    targetEntity: o.entity,
    runRef: o.runRef,
  } as const;

  const scaleHits = o.scale.filter(([, v]) => checkScale(v));
  if (scaleHits.length > 0) {
    await reportIngestionError({
      ...base,
      guardType: "range",
      targetField: "scale",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `|line item| ≤ ${SCALE_CEIL_CR} ₹Cr`,
      observed: scaleHits.map(([k, v]) => `${k}=${v}`).join(", "),
      detail: "Line item far beyond plausible ₹Cr — likely a unit-scale (÷1e7) parse break.",
    });
  }

  if (o.npa && checkNpaHierarchy(o.npa.nnpa, o.npa.gnpa)) {
    await reportIngestionError({
      ...base,
      guardType: "range",
      targetField: "npa",
      severity: "medium",
      resolutionPath: "source_code",
      expected: "NNPA ≤ GNPA",
      observed: `nnpa=${o.npa.nnpa} > gnpa=${o.npa.gnpa}`,
      detail: "Net NPA exceeds Gross NPA — impossible; a parse error.",
    });
  }

  if (o.solvency !== undefined && checkSolvencyImplausible(o.solvency)) {
    await reportIngestionError({
      ...base,
      guardType: "range",
      targetField: "solvencyRatio",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `solvency ≥ ${SOLVENCY_MIN}× (IRDAI floor 1.5×)`,
      observed: `solvency=${o.solvency}`,
      detail: "Solvency implausibly low (real ≥1.5×) — a parse/scale error, not distress.",
    });
  }

  if (o.yoy !== undefined && checkRevenueYoyAnomaly(o.yoy ?? null)) {
    await reportIngestionError({
      ...base,
      guardType: "continuity",
      targetField: o.yoyLabel ?? "yoy",
      severity: "low",
      resolutionPath: "source_code",
      expected: `|YoY| ≤ ${REVENUE_YOY_MAX_PCT}%`,
      observed: `${o.yoyLabel ?? "yoy"}=${o.yoy?.toFixed(0)}%`,
      detail: "Primary YoY beyond the sticky band — per-period scale break or real anomaly; eyeball.",
    });
  }
}
