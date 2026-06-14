// File: src/scoring/guardrail/signatures/a2-missing-fields.ts
//
// SIGNATURE A-2 — MISSING CRITICAL FIELDS (Category A, data integrity, AUTO).
// The ONE signature wired end-to-end in Phase 1. Chosen because (rulebook §1 A-2):
//   • Category A, AUTO — detection AND response both mechanical, no operator loop;
//   • its Solution is O2 (the §0.8 dual-exclusion outcome the whole build must
//     prove) WITH an O5 fallback ("too many fields missing → Hold"), so one
//     signature structurally exercises BOTH O2 and O5;
//   • simplest possible detection — a binary null check on four named fields;
//   • the rulebook frames it as "existing spec behavior (§14.4 / §5.8) surfaced as a
//     guardrail," i.e. the CONSUMER already handles it — we build only the PRODUCER.
//
// CONDITION (§1 A-2): any of revenue / netProfit / netWorth / totalAssets null in
// the latest annual `Fundamental` row used for scoring. Threshold: binary.
//
// METRICS-AFFECTED MAP (the FIXED map — makes the response deterministic, §2):
// each critical field → the FOUNDATION metrics that read it from the snapshot row
// and become uncomputable when it is null. Annual-Fundamental fields drive ONLY
// Foundation (Momentum reads the separate quarterly table — see FLAG below).
//
//   revenue     → F6 Receivables Days, F7 Asset Turnover, F10 Revenue 3y CAGR
//   netProfit   → F2 ROE, F3 Cash Conversion
//   netWorth    → F1 ROCE, F2 ROE, F4 D/E
//   totalAssets → F7 Asset Turnover
//
// (Verified against src/scoring/metrics/foundation.ts: each listed metric returns
// `unavailable("missing_line_item")` when its mapped field is null.)

import type {
  Signature,
  SignatureResult,
  GuardrailStockInput,
  AffectedMetric,
} from "../types.js";

/** The fixed field→Foundation-metrics dependency map (rulebook §1 A-2). */
const FIELD_TO_FOUNDATION_METRICS: Record<string, string[]> = {
  revenue: ["F6", "F7", "F10"],
  netProfit: ["F2", "F3"],
  netWorth: ["F1", "F2", "F4"],
  totalAssets: ["F7"],
};

/** Foundation has 10 metrics; §14.4 floor = ≥50% present to score the pillar
 *  (boundary 5/10 INCLUDED — pillars/types.ts PILLAR_FLOOR_RATIO). */
const FOUNDATION_METRIC_COUNT = 10;
const FOUNDATION_FLOOR_PRESENT = Math.ceil(FOUNDATION_METRIC_COUNT * 0.5); // 5

export const a2MissingFields: Signature = {
  key: "A-2",
  category: "A",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    // A-2 keys off the annual Fundamental row; it needs that row to be present at
    // all. (A wholly-absent latest Fundamental is A-1/A-3 territory, not A-2.)
    return input.latestFundamental !== null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const f = input.latestFundamental;
    if (!f) return null; // could not evaluate — distinct from "evaluated, did not fire"

    // Detection: which of the four critical fields are null.
    const nullFields: string[] = [];
    for (const field of ["revenue", "netProfit", "netWorth", "totalAssets"] as const) {
      if (f[field] === null) nullFields.push(field);
    }

    const base = {
      signatureKey: "A-2" as const,
      category: "A" as const,
      tier: "auto" as const,
    };

    if (nullFields.length === 0) {
      // Flag cleared — all critical fields present. O1, logged for audit (§7).
      return {
        ...base,
        fired: false,
        outcome: "O1",
        affectedMetrics: [],
        triggeringValues: { fiscalYear: f.fiscalYear, nullFields: [] },
        explanation: "All critical financial fields present; scored normally.",
      };
    }

    // Build the affected-metrics set (union over the null fields), deduped, with the
    // field that caused each suppression recorded for the audit/explanation.
    const reasonByMetric = new Map<string, string[]>();
    for (const field of nullFields) {
      for (const metricKey of FIELD_TO_FOUNDATION_METRICS[field]) {
        if (!reasonByMetric.has(metricKey)) reasonByMetric.set(metricKey, []);
        reasonByMetric.get(metricKey)!.push(field);
      }
    }
    const affectedMetrics: AffectedMetric[] = [...reasonByMetric.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([metricKey, fields]) => ({
        metricKey,
        pillar: "foundation" as const,
        reason: `depends on ${fields.join(" & ")} (null)`,
      }));

    // O2-vs-O5 escalation (§1 A-2 "if too many fields missing to compute any pillar
    // → O5 Hold"). INTERPRETED (flagged) as: if suppressing the affected metrics
    // pushes FOUNDATION — the composite's required anchor pillar — below its §14.4
    // floor, the composite would go UNAVAILABLE regardless, so HOLD (freeze last
    // clean) rather than emit suppressions that produce no score. Otherwise O2.
    const foundationPresentAfter = FOUNDATION_METRIC_COUNT - affectedMetrics.length;
    const breaksFoundationFloor = foundationPresentAfter < FOUNDATION_FLOOR_PRESENT;

    const triggeringValues = {
      fiscalYear: f.fiscalYear,
      nullFields,
      values: {
        revenue: f.revenue,
        netProfit: f.netProfit,
        netWorth: f.netWorth,
        totalAssets: f.totalAssets,
      },
      affectedMetricKeys: affectedMetrics.map((m) => m.metricKey),
      foundationPresentAfter,
      foundationFloor: FOUNDATION_FLOOR_PRESENT,
    };

    if (breaksFoundationFloor) {
      // O5 Hold — too much of Foundation suppressed to form a composite.
      return {
        ...base,
        fired: true,
        outcome: "O5",
        affectedMetrics: [], // hold is whole-stock, not per-metric
        triggeringValues,
        explanation:
          `Multiple core financial fields unavailable (${nullFields.join(", ")}) for ${f.fiscalYear} — ` +
          `too few Foundation metrics remain to compute a reliable Health Score. ` +
          `Score held at the last complete period; will update when full results are available.`,
      };
    }

    // O2 — suppress the affected metrics (dual-exclusion via §0.8); the rest score.
    return {
      ...base,
      fired: true,
      outcome: "O2",
      affectedMetrics,
      triggeringValues,
      explanation:
        `Some financial data unavailable (${nullFields.join(", ")}) for ${f.fiscalYear}; ` +
        `the metric(s) that depend on it (${affectedMetrics.map((m) => m.metricKey).join(", ")}) ` +
        `are excluded from the current Health Score. Remaining metrics scored normally. ` +
        `The raw figures remain visible in the breakdown, marked excluded.`,
    };
  },
};
