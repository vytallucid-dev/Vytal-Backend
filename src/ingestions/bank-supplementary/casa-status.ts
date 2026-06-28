// File: src/ingestions/bank-supplementary/casa-status.ts
//
// CASA STALENESS SIGNAL — the 12-bank checklist behind the admin staleness table.
// INFORMATIONAL, not a violation: report-timing varies by bank (private banks disclose
// earlier than PSUs), so a bank lacking the current calendar quarter is "not yet entered",
// not an error. The signal makes clear which banks are still on the legacy LIVE fallback
// (need a quarter injected to move off it) vs already on a real current quarter.
//
// Mirrors the scorer's TIERED read (resolveCasa): source ∈ "quarter" | "legacy_live" |
// "none". Under the preserving cutover (Option B, tier-3 dropped) the legacy ANNUAL rows
// are NOT a driving source — a bank with only annual CASA reports source="none" (neutral-60),
// exactly as the scorer treats it.

import { loadSupplementary } from "../../scoring/metrics/banking-load.js";
import { resolveCasa, periodOrdinal } from "../../scoring/metrics/banking-types.js";
import type { SupplementaryPoint } from "../../scoring/metrics/banking-types.js";
import { bankingPgSymbols } from "./inject-casa.js";
import type { BankingCasa, BankingCasaSeriesPoint } from "../../scoring/read/fundamentals-view.types.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Indian FY calendar → the current reportable quarter. FY starts April 1 and is labelled
 *  by its ENDING year (FY26 = Apr-2025…Mar-2026). Quarters: Apr-Jun=Q1, Jul-Sep=Q2,
 *  Oct-Dec=Q3, Jan-Mar=Q4. FY-BOUNDARY: Jan-Mar belongs to the FY that started the PRIOR
 *  April, so its FY label is the calendar year itself (Jan-2026 → FY26/Q4); Apr-Dec maps
 *  to calendarYear+1 (Jun-2025 → FY26/Q1). */
export function currentExpectedQuarter(now: Date = new Date()): { fiscalYear: string; quarter: string; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  let fyYear: number;
  let quarter: string;
  if (m >= 4 && m <= 6) { fyYear = y + 1; quarter = "Q1"; }
  else if (m >= 7 && m <= 9) { fyYear = y + 1; quarter = "Q2"; }
  else if (m >= 10 && m <= 12) { fyYear = y + 1; quarter = "Q3"; }
  else { fyYear = y; quarter = "Q4"; } // Jan-Mar — FY that started the PRIOR April
  const fiscalYear = `FY${String(fyYear).slice(-2)}`;
  return { fiscalYear, quarter, label: `${fiscalYear}/${quarter}` };
}

export interface CasaStatusRow {
  symbol: string;
  currentExpectedQuarter: string; // "FY27/Q1"
  hasCurrentQuarter: boolean; // a found quarter-keyed row for EXACTLY the expected (FY, Q)?
  latestQuarterOnFile: string | null; // newest quarter-keyed found row "FY26/Q4", or null
  latestValue: number | null; // the CASA value DRIVING the score (resolved tier), or null (neutral-60)
  source: "quarter" | "legacy_live" | "none"; // which tier the scorer resolves to
  lastUpdatedAt: string | null; // ISO — when the driving row was inserted/updated (null if none)
}

export interface CasaStatusResult {
  currentExpectedQuarter: string;
  summary: { total: number; onCurrentQuarter: number; onLegacyLive: number; onNeutral: number };
  banks: CasaStatusRow[];
}

/** Build the 12-bank CASA staleness checklist for the current calendar quarter. */
export async function computeCasaStatus(db: Db = prisma, now: Date = new Date()): Promise<CasaStatusResult> {
  const expected = currentExpectedQuarter(now);
  const symbols = [...(await bankingPgSymbols(db))].sort();

  const banks: CasaStatusRow[] = [];
  for (const symbol of symbols) {
    const { casa } = await loadSupplementary(symbol);
    banks.push(casaRowFromMap(symbol, casa, expected));
  }

  const summary = {
    total: banks.length,
    onCurrentQuarter: banks.filter((b) => b.hasCurrentQuarter).length,
    onLegacyLive: banks.filter((b) => b.source === "legacy_live").length,
    onNeutral: banks.filter((b) => b.source === "none").length,
  };

  return { currentExpectedQuarter: expected.label, summary, banks };
}

/** Resolve ONE bank's CASA status row from its already-loaded supplementary map — the
 *  per-bank core shared by the admin checklist (computeCasaStatus) and the display read
 *  (buildCasaDisplay). The SINGLE place tier → status fields are derived, so both surfaces
 *  stay byte-for-byte consistent. */
function casaRowFromMap(
  symbol: string,
  casa: Map<string, SupplementaryPoint>,
  expected: { fiscalYear: string; quarter: string; label: string },
): CasaStatusRow {
  const resolved = resolveCasa(casa);

  let latestQuarterOnFile: string | null = null;
  let bestOrd = -Infinity;
  let hasCurrentQuarter = false;
  for (const p of casa.values()) {
    if (p.quarter !== null && p.status === "found" && p.value !== null) {
      const ord = periodOrdinal(p.fiscalYear, p.quarter);
      if (ord > bestOrd) { bestOrd = ord; latestQuarterOnFile = `${p.fiscalYear}/${p.quarter}`; }
      if (p.fiscalYear === expected.fiscalYear && p.quarter === expected.quarter) hasCurrentQuarter = true;
    }
  }

  return {
    symbol,
    currentExpectedQuarter: expected.label,
    hasCurrentQuarter,
    latestQuarterOnFile,
    latestValue: resolved ? resolved.point.value : null,
    source: resolved ? resolved.tier : "none",
    lastUpdatedAt: resolved && resolved.point.createdAt ? resolved.point.createdAt.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY READ PATH — CASA for the banking fundamentals view (buildFundamentalsView →
// banking branch). Exposes the SAME tiered current value the admin status table shows,
// PLUS the full entered quarter series for the history chart. Purely additive on the read
// side — does NOT touch the admin status/POST entry path. Banks-only by construction (only
// the banking fundamentals branch calls it); a bank with no entered CASA returns honest
// -empty (current.value null, source "none", series []) — never a fabricated value.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildCasaDisplay(symbol: string, now: Date = new Date()): Promise<BankingCasa> {
  const expected = currentExpectedQuarter(now);
  const { casa } = await loadSupplementary(symbol);
  const row = casaRowFromMap(symbol, casa, expected);

  // Full entered quarter history — quarter-keyed found rows only, ascending — for the chart.
  // Legacy LIVE/annual rows (quarter=null) are NOT series points. CASA is stored as PERCENT,
  // so values pass through as-is (no ×100). There is no stored period-end column — the quarter
  // label IS the period identity — so periodEnd is honestly null.
  const series: BankingCasaSeriesPoint[] = [...casa.values()]
    .filter((p) => p.quarter !== null && p.status === "found" && p.value !== null)
    .sort((a, b) => periodOrdinal(a.fiscalYear, a.quarter as string) - periodOrdinal(b.fiscalYear, b.quarter as string))
    .map((p) => ({ quarter: `${p.fiscalYear}/${p.quarter}`, value: p.value as number, periodEnd: null }));

  return {
    current: {
      value: row.latestValue,
      quarter: row.latestQuarterOnFile,
      source: row.source,
      isCurrent: row.hasCurrentQuarter,
      asOf: row.lastUpdatedAt,
    },
    series,
  };
}
