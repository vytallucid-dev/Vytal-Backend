// File: src/scoring/metric-scoring/live-dispatch.ts
//
// THE PG-AWARE METRIC-SELECTION DISPATCH (the generic mechanism).
//
// WHY THIS EXISTS: specMetricKey is POSITIONAL, not semantic — there is NO
// universal F1. PG2/PG9 score F1=ROCE; PG8 additionally scores F1_OPM=Operating
// Margin AND its Momentum set is {M1_OPM_TTM, M2, M3, M4} (NO M1, NO M5); banking
// (PG5/PG6) is an ENTIRELY different set (F1=Tier-1). So the engine must select,
// PER PG, (a) which metric keys to compute and (b) which live-value function to
// call for each — driven by the loaded bar-set (FINAL.json), NOT a hardcoded
// F1..F10/M1..M5 list.
//
// This module is the SINGLE reviewable artifact: the metric-key → live-value-
// function MAPPING TABLE plus a thin JSON-driven dispatcher that reads it. There
// is NO per-PG if/else anywhere — a PG's behavior is fully determined by its
// industryType and its metric-key set. PG8 is the first caller that exercises the
// non-universal path; banking reuses the same machinery later.
//
// PURE: no DB, no I/O. Computes live VALUES only (the scoring/SSCU/bars step is the
// caller's, via scoreMetricCrossSection). CN-8: the dispatch SELECTS and ROUTES;
// it never alters a bar or a derived value.

import {
  f1Roce, f2Roe, f3CashConversion, f4DebtEquity, f5InterestCoverage,
  f6ReceivablesDays, f7AssetTurnover, f8FcfPatAvg, f9OcfConsistency, f10Revenue3yCagr,
  fOpmOperatingMargin,
} from "../metrics/foundation.js";
import {
  m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage,
  consecutiveTail,
} from "../metrics/momentum.js";
import { computeBankingLiveValues } from "../metrics/banking.js";
import type { BankingCtx } from "../metrics/banking-types.js";
import type { FoundationAnnual, MomentumQuarter, MetricValue } from "../metrics/types.js";
import type { IndustryType, Pillar } from "../bars-loader/label-map.js";

// ── Compute contexts (everything a live-value fn needs, built once per stock) ────
export interface FoundationCtx {
  rows: FoundationAnnual[]; // sorted ascending by fyOrdinal
  snap: FoundationAnnual; // latest standalone FY
  prior: FoundationAnnual | null; // FY-1 (for the F3 buyback inference)
  snapshotOrdinal: number;
  periodAvgPrice: number | null;
}
export interface MomentumCtx {
  run: MomentumQuarter[]; // the consecutive-tail run (oldest→newest)
}

export type FoundationFn = (c: FoundationCtx) => MetricValue;
export type MomentumFn = (c: MomentumCtx) => MetricValue;

// ════════════════════════════════════════════════════════════════════════════
// THE REVIEWABLE MAPPING TABLE — engine metric key → live-value function.
// EVERY key the engine can score is listed here exactly once per (industry).
// non_financial is BUILT; banking keys are DECLARED but mapped to a deferred stub
// (gated — see dispatchLiveValues). Review each key→function row.
// ════════════════════════════════════════════════════════════════════════════
export const FOUNDATION_DISPATCH: Record<string, FoundationFn> = {
  F1:     (c) => f1Roce(c.snap),
  F2:     (c) => f2Roe(c.snap),
  F3:     (c) => f3CashConversion(c.snap, c.prior, c.periodAvgPrice),
  F4:     (c) => f4DebtEquity(c.snap),
  F5:     (c) => f5InterestCoverage(c.snap),
  F6:     (c) => f6ReceivablesDays(c.snap),
  F7:     (c) => f7AssetTurnover(c.snap),
  F8:     (c) => f8FcfPatAvg(c.rows, c.snapshotOrdinal),
  F9:     (c) => f9OcfConsistency(c.rows, c.snapshotOrdinal),
  F10:    (c) => f10Revenue3yCagr(c.rows, c.snapshotOrdinal),
  F1_OPM: (c) => fOpmOperatingMargin(c.snap), // NEW — PG8 Foundation OPM (EBITDA-based)
};

// emitAs: route a key to an existing live-value fn but stamp the result with a
// different metric key/label (the §"emit rename"). Used for PG8's M1_OPM_TTM, which
// reuses the SHARED EBITDA m1TtmOpm but must surface under its own key.
const emitAs = (key: string, label: string, fn: MomentumFn): MomentumFn =>
  (c) => ({ ...fn(c), key, label });

export const MOMENTUM_DISPATCH: Record<string, MomentumFn> = {
  M1:         (c) => m1TtmOpm(c.run),
  M2:         (c) => m2TtmNpm(c.run),
  M3:         (c) => m3RevenueYoyTtm(c.run),
  M4:         (c) => m4NetProfitYoyTtm(c.run),
  M5:         (c) => m5TtmInterestCoverage(c.run),
  // PG8 OPM: the SHARED EBITDA m1TtmOpm, emit-renamed to M1_OPM_TTM. NOT a separate
  // fn — M1 and M1_OPM_TTM are the identical EBITDA computation (model-wide OPM fix).
  M1_OPM_TTM: emitAs("M1_OPM_TTM", "TTM OPM % (EBITDA)", (c) => m1TtmOpm(c.run)),
};

// Banking keys (now BUILT — see metrics/banking.ts). Foundation 7 / Momentum 5.
export const BANKING_FOUNDATION_KEYS = ["Tier1", "GNPA", "NNPA", "PCR", "ROA", "CI", "CASA"];
export const BANKING_MOMENTUM_KEYS = ["NIM", "PPOP", "NII", "NPyoy", "GNPAttm"];
export const BANK_DATA_PIPELINE_PENDING = "scoring_pending_bank_data_pipeline";

// Human fn names for the printable table (banking).
const BANKING_FN_NAME: Record<string, string> = {
  Tier1: "f1Tier1", GNPA: "f2Gnpa", NNPA: "f3Nnpa", PCR: "f4Pcr", ROA: "f5Roa", CI: "f6CostIncome", CASA: "f7Casa",
  NIM: "m1NimTtm", PPOP: "m2PpopYoy", NII: "m3NiiYoy", NPyoy: "m4NpYoy", GNPAttm: "m5GnpaTtm",
};

// ── The printable artifact (one row per dispatchable key) ────────────────────────
export type DispatchStatus = "implemented" | "new" | "reuse_rekey" | "deferred_bank_pipeline";
export interface DispatchEntry {
  key: string;
  pillar: Pillar;
  industry: IndustryType;
  fn: string; // the live-value function (human name)
  status: DispatchStatus;
  note: string;
}

export const DISPATCH_TABLE: DispatchEntry[] = [
  { key: "F1",  pillar: "foundation", industry: "non_financial", fn: "f1Roce",              status: "implemented", note: "ROCE %" },
  { key: "F2",  pillar: "foundation", industry: "non_financial", fn: "f2Roe",               status: "implemented", note: "ROE %" },
  { key: "F3",  pillar: "foundation", industry: "non_financial", fn: "f3CashConversion",    status: "implemented", note: "Cash Conversion (ratio)" },
  { key: "F4",  pillar: "foundation", industry: "non_financial", fn: "f4DebtEquity",        status: "implemented", note: "D/E (ratio, lower_better)" },
  { key: "F5",  pillar: "foundation", industry: "non_financial", fn: "f5InterestCoverage",  status: "implemented", note: "Interest Coverage (x)" },
  { key: "F6",  pillar: "foundation", industry: "non_financial", fn: "f6ReceivablesDays",   status: "implemented", note: "Receivables Days (lower_better)" },
  { key: "F7",  pillar: "foundation", industry: "non_financial", fn: "f7AssetTurnover",     status: "implemented", note: "Asset Turnover (x)" },
  { key: "F8",  pillar: "foundation", industry: "non_financial", fn: "f8FcfPatAvg",         status: "implemented", note: "FCF/PAT 4y avg (ratio)" },
  { key: "F9",  pillar: "foundation", industry: "non_financial", fn: "f9OcfConsistency",    status: "implemented", note: "OCF Consistency %" },
  { key: "F10", pillar: "foundation", industry: "non_financial", fn: "f10Revenue3yCagr",    status: "implemented", note: "Revenue 3y CAGR %" },
  { key: "F1_OPM",     pillar: "foundation", industry: "non_financial", fn: "fOpmOperatingMargin", status: "new",         note: "NEW — EBITDA-based operating margin (PG8's 11th Foundation metric)" },
  { key: "M1",  pillar: "momentum",   industry: "non_financial", fn: "m1TtmOpm",            status: "implemented", note: "TTM OPM % (EBITDA, PRE-dep — shared across all 11 PGs)" },
  { key: "M2",  pillar: "momentum",   industry: "non_financial", fn: "m2TtmNpm",            status: "implemented", note: "TTM NPM %" },
  { key: "M3",  pillar: "momentum",   industry: "non_financial", fn: "m3RevenueYoyTtm",     status: "implemented", note: "Revenue YoY (TTM) %" },
  { key: "M4",  pillar: "momentum",   industry: "non_financial", fn: "m4NetProfitYoyTtm",   status: "implemented", note: "Net Profit YoY (TTM) %" },
  { key: "M5",  pillar: "momentum",   industry: "non_financial", fn: "m5TtmInterestCoverage", status: "implemented", note: "TTM Interest Coverage (x)" },
  { key: "M1_OPM_TTM", pillar: "momentum", industry: "non_financial", fn: "m1TtmOpm", status: "reuse_rekey", note: "PG8 OPM = the SHARED EBITDA m1TtmOpm, emit-renamed to M1_OPM_TTM. Same computation as M1 (model-wide OPM fix; no separate PG8 fn)" },
  // Banking — BUILT (metrics/banking.ts). Computed when a BankingCtx is supplied.
  ...BANKING_FOUNDATION_KEYS.map((k): DispatchEntry => ({ key: k, pillar: "foundation", industry: "banking", fn: BANKING_FN_NAME[k], status: "implemented", note: "banking foundation live-value" })),
  ...BANKING_MOMENTUM_KEYS.map((k): DispatchEntry => ({ key: k, pillar: "momentum", industry: "banking", fn: BANKING_FN_NAME[k], status: "implemented", note: "banking momentum live-value" })),
];

/** Print the mapping table (the reviewable artifact). */
export function printDispatchTable(log: (s: string) => void = console.log): void {
  const w = Math.max(...DISPATCH_TABLE.map((e) => e.key.length), 6);
  const fw = Math.max(...DISPATCH_TABLE.map((e) => e.fn.length), 8);
  log(`  ${"KEY".padEnd(w)}  ${"PILLAR".padEnd(10)}  ${"INDUSTRY".padEnd(13)}  ${"LIVE-VALUE FN".padEnd(fw)}  ${"STATUS".padEnd(21)}  NOTE`);
  log(`  ${"─".repeat(w)}  ${"─".repeat(10)}  ${"─".repeat(13)}  ${"─".repeat(fw)}  ${"─".repeat(21)}  ${"─".repeat(4)}`);
  for (const e of DISPATCH_TABLE) {
    log(`  ${e.key.padEnd(w)}  ${e.pillar.padEnd(10)}  ${e.industry.padEnd(13)}  ${e.fn.padEnd(fw)}  ${e.status.padEnd(21)}  ${e.note}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THE DISPATCHER — JSON-driven per-PG selection. No per-PG branching.
// ════════════════════════════════════════════════════════════════════════════
export interface DispatchInput {
  industryType: IndustryType;
  /** The PG's ACTUAL foundation metric keys (from the loaded bar-set / FINAL.json). */
  foundationKeys: string[];
  /** The PG's ACTUAL momentum metric keys (from the loaded bar-set / FINAL.json). */
  momentumKeys: string[];
  foundationRows: FoundationAnnual[];
  momentumQuarters: MomentumQuarter[];
  periodAvgPrice?: number | null;
  /** Banking compute context (BankingFundamental + Quarterly + BankSupplementary).
   *  Required when industryType="banking"; ignored otherwise. When absent on a
   *  banking PG, the dispatcher returns the legacy gated state (back-compat). */
  bankingCtx?: BankingCtx | null;
}

export type DispatchOutput =
  | {
      status: "computed";
      industryType: IndustryType;
      foundation: MetricValue[]; // one per selected foundation key, in key order
      momentum: MetricValue[]; // one per selected momentum key, in key order
      snapshotFy: string | null;
      snapshotQuarter: string | null;
    }
  | {
      status: "scoring_pending_bank_data_pipeline";
      industryType: "banking";
      foundationKeys: string[];
      momentumKeys: string[];
      note: string;
    };

/** A visible (never silent) placeholder when a selected key has no mapped fn — a
 *  dispatch gap, surfaced as an unavailable metric with a loud flag. */
function noFn(key: string, pillar: "foundation" | "momentum"): MetricValue {
  return {
    key, label: key, available: false, value: null, unit: "n/a", source: "none",
    formula: `DISPATCH GAP: no live-value function mapped for ${pillar} key "${key}"`,
    inputs: {}, reason: null,
    flags: [`⚠ DISPATCH GAP: key "${key}" is in the PG's set but has no live-value function in the mapping table — NOT scored (never a silent zero)`],
  };
}
function noData(key: string, reason: "standalone_absent"): MetricValue {
  return {
    key, label: key, available: false, value: null, unit: "n/a", source: "none",
    formula: "no standalone rows for this stock", inputs: {}, reason, flags: [],
  };
}

/**
 * Select + compute the live values for ONE PG's metric set. Banking PGs return a
 * LABELED deferred state (never a score). Non-financial PGs compute exactly their
 * selected keys via the mapping table. PURE.
 */
export function dispatchLiveValues(input: DispatchInput): DispatchOutput {
  // BANKING: compute via the banking live-value module when a BankingCtx is supplied
  // (UNGATED — metrics/banking.ts is built). Without a ctx, return the legacy gated
  // state so any caller that hasn't wired banking data still gets an honest deferral
  // (never a silent zero / fabricated score).
  if (input.industryType === "banking") {
    if (!input.bankingCtx) {
      return {
        status: "scoring_pending_bank_data_pipeline",
        industryType: "banking",
        foundationKeys: input.foundationKeys,
        momentumKeys: input.momentumKeys,
        note: "banking PG dispatched without a BankingCtx — supply input.bankingCtx to compute (metrics/banking.ts is built)",
      };
    }
    const b = computeBankingLiveValues(input.bankingCtx, input.foundationKeys, input.momentumKeys);
    return { status: "computed", industryType: "banking", foundation: b.foundation, momentum: b.momentum, snapshotFy: b.snapshotFy, snapshotQuarter: b.snapshotQuarter };
  }

  // NON-FINANCIAL: build the contexts once, then compute exactly the selected keys.
  const fRows = [...input.foundationRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  let foundation: MetricValue[];
  let snapshotFy: string | null = null;
  if (fRows.length > 0) {
    const snap = fRows[fRows.length - 1];
    const prior = fRows.find((r) => r.fyOrdinal === snap.fyOrdinal - 1) ?? null;
    const ctx: FoundationCtx = { rows: fRows, snap, prior, snapshotOrdinal: snap.fyOrdinal, periodAvgPrice: input.periodAvgPrice ?? null };
    snapshotFy = snap.fiscalYear;
    foundation = input.foundationKeys.map((k) => (FOUNDATION_DISPATCH[k] ? FOUNDATION_DISPATCH[k](ctx) : noFn(k, "foundation")));
  } else {
    foundation = input.foundationKeys.map((k) => noData(k, "standalone_absent"));
  }

  const run = consecutiveTail(input.momentumQuarters);
  let momentum: MetricValue[];
  let snapshotQuarter: string | null = null;
  if (run.length > 0) {
    const ctx: MomentumCtx = { run };
    const tail = run[run.length - 1];
    snapshotQuarter = `${tail.fiscalYear}${tail.quarter}`;
    momentum = input.momentumKeys.map((k) => (MOMENTUM_DISPATCH[k] ? MOMENTUM_DISPATCH[k](ctx) : noFn(k, "momentum")));
  } else {
    momentum = input.momentumKeys.map((k) => noData(k, "standalone_absent"));
  }

  return { status: "computed", industryType: "non_financial", foundation, momentum, snapshotFy, snapshotQuarter };
}

/** Extract a PG's actual (pillar, key) selection from a loaded bars report's
 *  per-PG mapping (mapped rows only). This is the JSON-driven selection source —
 *  NOT a hardcoded universal list. */
export function selectPgKeys(mapping: { pillar: "foundation" | "momentum"; key: string | null }[]): {
  foundationKeys: string[];
  momentumKeys: string[];
} {
  const foundationKeys: string[] = [];
  const momentumKeys: string[] = [];
  for (const m of mapping) {
    if (m.key === null) continue;
    if (m.pillar === "foundation") foundationKeys.push(m.key);
    else momentumKeys.push(m.key);
  }
  return { foundationKeys, momentumKeys };
}
