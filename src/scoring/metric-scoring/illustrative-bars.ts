// File: src/scoring/metric-scoring/illustrative-bars.ts
//
// ⚠⚠⚠ ILLUSTRATIVE / THROWAWAY BAR SET — NOT REAL CN-4 BARS ⚠⚠⚠
//
// These five-tier thresholds are HAND-SET to roughly plausible large-cap values
// PURELY to exercise the lens-wiring (L1 landing, the §5.3.1/§5.4.1 anchor-lift
// COUNTING, the composite). They are NOT sector-derived, NOT calibrated, NOT
// CN-4. They MUST NEVER be mistaken for production bars or used to score anything
// real. Phase 6 derives real per-PG bars into score_metric_bar_sets; at that point
// the wiring reads bars via bars.ts:loadBarSet and this file is deleted.
//
// Every bar set carries `illustrative: true` and a loud `note` so the label
// travels with the data into every printed result.

import type { MetricBarSetInput } from "./types.js";

const THROWAWAY =
  "⚠ ILLUSTRATIVE/THROWAWAY — hand-set, NOT CN-4/sector-derived. Exists only to exercise the wiring; recompute against real score_metric_bar_sets in Phase 6.";

const bar = (
  metricKey: string,
  direction: MetricBarSetInput["direction"],
  excellent: number, good: number, acceptable: number, concerning: number, distress: number,
): MetricBarSetInput => ({
  metricKey, direction,
  bars: { excellent, good, acceptable, concerning, distress },
  note: THROWAWAY, illustrative: true, barPath: "ILLUSTRATIVE", metricBarSetId: null,
});

// Foundation (F1–F10). higher_better unless noted.
// Momentum (M1–M5). All higher_better.
export const ILLUSTRATIVE_BARS: Record<string, MetricBarSetInput> = {
  // key            dir              exc    good   acc    con    dis
  F1:  bar("F1",  "higher_better",  25,    18,    12,    8,     4),     // ROCE %
  F2:  bar("F2",  "higher_better",  22,    16,    12,    8,     4),     // ROE %
  F3:  bar("F3",  "higher_better",  1.10,  0.90,  0.75,  0.50,  0.30),  // Cash Conversion (ratio)
  F4:  bar("F4",  "lower_better",   0.10,  0.30,  0.60,  1.00,  1.50),  // D/E (lower is better)
  F5:  bar("F5",  "higher_better",  15,    8,     4,     2.5,   1.5),    // Interest Coverage (x)
  F6:  bar("F6",  "lower_better",   30,    45,    60,    90,    120),    // Receivables Days (lower better)
  F7:  bar("F7",  "higher_better",  1.50,  1.10,  0.80,  0.50,  0.30),  // Asset Turnover (x)
  F8:  bar("F8",  "higher_better",  1.00,  0.80,  0.60,  0.40,  0.20),  // FCF/PAT 4y avg (ratio)
  F9:  bar("F9",  "higher_better",  100,   90,    80,    60,    40),     // OCF Consistency %
  F10: bar("F10", "higher_better",  20,    14,    10,    6,     2),      // Revenue 3y CAGR %
  M1:  bar("M1",  "higher_better",  30,    22,    16,    10,    5),      // TTM OPM %
  M2:  bar("M2",  "higher_better",  25,    18,    12,    7,     3),      // TTM NPM %
  M3:  bar("M3",  "higher_better",  20,    14,    10,    5,     0),      // Revenue YoY (TTM) %
  M4:  bar("M4",  "higher_better",  25,    15,    10,    4,    -5),      // Net Profit YoY (TTM) %
  M5:  bar("M5",  "higher_better",  15,    8,     4,     2.5,   1.5),    // TTM Interest Coverage (x)
};
