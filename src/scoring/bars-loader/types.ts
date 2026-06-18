// File: src/scoring/bars-loader/types.ts
//
// Shapes for the Phase-6 per-PG bar LOADER. Two families:
//   • the SOURCE shape (vytal_pg_bars.json) — we CONFORM to it, never reshape it;
//   • the would-WRITE shape (one prospective score_metric_bar_sets row) + the
//     per-PG report the validate-only run prints.
//
// PURE types only.

import type { BarDirection, EngineUnit, IndustryType } from "./label-map.js";

// ── SOURCE shape (vytal_pg_bars.json, spec framework v5.5.1) ─────────────────────
export interface SourceFiveBars {
  excellent: number;
  good: number;
  acceptable: number;
  concerning: number;
  distress: number;
}

/** 3-anchor SSCU override (only distress/good/excellent populated; the other two
 *  are legitimately null — handoff §7). */
export interface SourceThreeAnchorBars {
  distress: number;
  good: number;
  excellent: number;
  acceptable: null;
  concerning: null;
}

export interface SourceMetric {
  metricLabel: string;
  specMetricKey: string | null; // UNRELIABLE — never used for mapping (see label-map.ts)
  direction: BarDirection;
  bars: SourceFiveBars;
  intraPillarWeight: number | null; // null = equal weight
  unit: string; // "percent" | "ratio" | "times" | "days" (JSON vocabulary)
  sourceRef?: string;
  status: string;
  sscuBars?: SourceThreeAnchorBars; // optional per-stock override
  sscuScope?: string[]; // stocks the override applies to
}

export interface SourcePeerGroup {
  pgId: string; // "PG1".."PG14"
  pgName: string;
  industryType: IndustryType;
  inheritsBarsFrom: string | null; // null | "PG5"
  foundationMetrics: SourceMetric[];
  momentumMetrics: SourceMetric[];
}

export interface SourceDocument {
  specVersionFramework: string; // "v5.5.1"
  extractionDate: string; // "2026-06-15"
  peerGroups: SourcePeerGroup[];
}

// ── WOULD-WRITE shape (one prospective score_metric_bar_sets row) ────────────────
/** The engine 3-anchor SSCU override carried out-of-band (stored in
 *  BarProvenance.evidence on commit; surfaced by loadBarSet at scoring time). */
export interface SscuOverride {
  bars: { distress: number; good: number; excellent: number };
  scope: string[];
}

export interface WouldWriteRow {
  barPath: string; // the pgId (the logical bar path)
  metricKey: string; // resolved engine canonical key
  rawLabel: string; // source label (provenance / audit)
  specMetricKeySource: string | null; // the UNTRUSTED source key, recorded for audit
  direction: BarDirection;
  unit: EngineUnit; // engine-normalized, == registry expected unit (asserted)
  bars: SourceFiveBars; // the 5 threshold VALUES (engine attaches anchor scores)
  intraPillarWeight: number | null;
  sscu: SscuOverride | null;
  collapsedPairs: number; // count of equal adjacent (E,G,A,C,D) pairs
  // assigned metadata (the JSON does not carry these — handoff §1):
  version: number;
  inForceFrom: string; // ISO date
  specVersionFramework: string; // "v5.5.1" → resolved to a ScoringSpecVersion row on commit
  derivationLayer: "layer_a" | "layer_b" | "layer_c";
  // inheritance: set on PG6's prospective rows (it references PG5's bar-set)
  inheritsFromPeerGroupId: string | null;
}

// ── per-PG + overall REPORT (what the validate-only run prints) ──────────────────
export interface MappingEntry {
  pillar: "foundation" | "momentum";
  rawLabel: string;
  normalized: string;
  key: string | null;
  unit: string;
  direction: BarDirection;
}

export interface ValidationIssue {
  metricKey: string | null;
  rawLabel: string;
  kind:
    | "unmapped_label"
    | "missing_bar"
    | "monotonicity"
    | "bad_direction"
    | "unknown_unit"
    | "unit_mismatch_vs_registry"
    | "direction_mismatch_vs_registry"
    | "bad_weight"
    | "bad_sscu";
  detail: string;
}

export interface PerPgReport {
  pgId: string;
  pgName: string;
  industry: IndustryType;
  inheritsBarsFrom: string | null;
  metricsSeen: number;
  metricsMapped: number;
  collapsesDetected: number; // metrics with ≥1 collapsed pair
  degenerateAllEqual: number; // metrics with all 5 bars equal
  sscuMetrics: number;
  mapping: MappingEntry[];
  issues: ValidationIssue[];
  wouldWriteRowCount: number; // 0 for an inheriting PG (references the parent's set)
  pass: boolean;
}

export interface Pg5Pg6Check {
  applicable: boolean;
  parentPgId: string | null;
  childPgId: string | null;
  byteIdentical: boolean;
  detail: string;
}

export interface LoadReport {
  sourcePath: string;
  specVersionFramework: string;
  extractionDate: string;
  mode: "validate_only" | "commit";
  perPg: PerPgReport[];
  pg5pg6: Pg5Pg6Check;
  wouldWrite: WouldWriteRow[];
  totalMetrics: number;
  totalMapped: number;
  totalWouldWriteRows: number;
  pass: boolean;
  failureSummary: string[];
}
