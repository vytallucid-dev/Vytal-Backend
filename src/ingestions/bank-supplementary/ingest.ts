// File: src/ingestions/bank-supplementary/ingest.ts
//
// Ingest manually-entered supplementary banking figures (CASA, Tier-1 history)
// from a single JSON payload. Strict, ATOMIC (all-or-nothing) validation, then
// an APPEND-ONLY supersede write:
//   new cell           → insert version 1                ("inserted")
//   same value+source  → no-op                           ("unchanged")
//   changed value/src  → insert version N+1, supersede   ("superseded")
//
// Nothing is ever updated in place; reads take MAX(version) per cell.

import { prisma } from "../../db/prisma.js";
import type { BankSupplementaryMetric } from "../../generated/prisma/client.js";

// ── Canonical JSON contract (see docs/bank-supplementary-format.md) ──────────

export interface BankSupplementaryEntryInput {
  symbol: string;
  metric: string; // BankSupplementaryMetric value: "casa_pct" | "tier1_pct"
  fiscalYear: string; // "FY24"
  quarter?: string | null; // "Q1".."Q4"; omit/null for an annual figure
  value: number; // PERCENT, e.g. 43.82 (not a fraction)
  sourceCitation: string; // REQUIRED, non-empty
  sourceDate: string; // "YYYY-MM-DD"
}

export interface BankSupplementaryUploadInput {
  enteredBy: string;
  entries: unknown[]; // validated per-entry below so we can report clean reasons
}

export type EntryAction = "inserted" | "superseded" | "unchanged";

export interface AcceptedEntryResult {
  index: number;
  symbol: string;
  metric: string;
  fiscalYear: string;
  quarter: string | null;
  action: EntryAction;
  version: number;
  rowId: string;
}

export interface RejectedEntry {
  index: number;
  symbol?: string;
  reason: string;
}

export interface BankSupplementaryUploadResult {
  ok: boolean; // false ⇒ at least one entry rejected ⇒ NOTHING was written
  summary: {
    inserted: number;
    superseded: number;
    unchanged: number;
    rejected: number;
    total: number;
  };
  results: AcceptedEntryResult[]; // empty when ok === false
  rejected: RejectedEntry[];
}

// ── Validation constants ─────────────────────────────────────────────────────

const VALID_METRICS = new Set<string>(["casa_pct", "tier1_pct"]);
const FY_RE = /^FY\d{2}$/;
const QUARTER_RE = /^Q[1-4]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALUE_MIN = 0;
const VALUE_MAX = 100; // CASA & Tier-1 are percentages in [0, 100]

// A fully-validated, resolved entry ready to write.
interface PreparedEntry {
  index: number;
  stockId: string;
  symbol: string;
  metric: BankSupplementaryMetric;
  fiscalYear: string;
  quarter: string | null;
  value: number;
  sourceCitation: string;
  sourceDate: Date;
}

/**
 * Validate + ingest a bank-supplementary JSON upload.
 *
 * ALL-OR-NOTHING: if ANY entry fails validation, nothing is written and the
 * result carries `ok: false` with a per-entry `rejected` list. Only when every
 * entry is valid do we open a transaction and apply the supersede writes.
 */
export async function ingestBankSupplementary(
  input: BankSupplementaryUploadInput,
): Promise<BankSupplementaryUploadResult> {
  const rejected: RejectedEntry[] = [];
  const entries = input.entries;

  // ── Resolve every referenced symbol once (must be an existing BANK) ──
  const symbols = new Set<string>();
  for (const raw of entries) {
    const s = (raw as Record<string, unknown> | null)?.symbol;
    if (typeof s === "string" && s.trim()) symbols.add(s.trim().toUpperCase());
  }
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: [...symbols] } },
    select: { id: true, symbol: true, industryType: true },
  });
  const stockBySymbol = new Map(stocks.map((s) => [s.symbol, s]));

  // ── Per-entry validation ──
  const prepared: PreparedEntry[] = [];
  for (let index = 0; index < entries.length; index++) {
    const e = entries[index] as Record<string, unknown> | null;
    const reasons: string[] = [];

    if (!e || typeof e !== "object") {
      rejected.push({ index, reason: "entry is not an object" });
      continue;
    }

    // symbol → must resolve to an existing Stock with industryType "banking"
    const symbolRaw = typeof e.symbol === "string" ? e.symbol.trim().toUpperCase() : "";
    let stockId = "";
    if (!symbolRaw) {
      reasons.push("symbol is required");
    } else {
      const stock = stockBySymbol.get(symbolRaw);
      if (!stock) reasons.push(`unknown symbol "${symbolRaw}" (no such Stock)`);
      else if (stock.industryType !== "banking")
        reasons.push(
          `symbol "${symbolRaw}" is not a bank (industryType=${stock.industryType}); CASA/Tier-1 are bank-only`,
        );
      else stockId = stock.id;
    }

    // metric → must be a valid enum value
    const metric = typeof e.metric === "string" ? e.metric : "";
    if (!VALID_METRICS.has(metric))
      reasons.push(
        `metric must be one of [${[...VALID_METRICS].join(", ")}], got ${JSON.stringify(e.metric)}`,
      );

    // fiscalYear → "FY" + 2 digits
    const fiscalYear = typeof e.fiscalYear === "string" ? e.fiscalYear : "";
    if (!FY_RE.test(fiscalYear))
      reasons.push(`fiscalYear must match /^FY\\d{2}$/, got ${JSON.stringify(e.fiscalYear)}`);

    // quarter → optional; null/omitted = annual; else Q1..Q4
    let quarter: string | null = null;
    if (e.quarter !== undefined && e.quarter !== null) {
      if (typeof e.quarter === "string" && QUARTER_RE.test(e.quarter)) {
        quarter = e.quarter;
      } else {
        reasons.push(`quarter must be Q1..Q4 or null/omitted, got ${JSON.stringify(e.quarter)}`);
      }
    }

    // value → number within [0, 100] (percent)
    const value = e.value;
    if (typeof value !== "number" || Number.isNaN(value)) {
      reasons.push(`value must be a number (percent), got ${JSON.stringify(value)}`);
    } else if (value < VALUE_MIN || value > VALUE_MAX) {
      reasons.push(`value ${value} out of range [${VALUE_MIN}, ${VALUE_MAX}] (percent)`);
    }

    // sourceCitation → REQUIRED, non-empty (the hard "no sourceless values" rule)
    const sourceCitation = typeof e.sourceCitation === "string" ? e.sourceCitation.trim() : "";
    if (!sourceCitation) reasons.push("sourceCitation is required and must be non-empty");

    // sourceDate → "YYYY-MM-DD"
    let sourceDate: Date | null = null;
    const sd = e.sourceDate;
    if (typeof sd !== "string" || !DATE_RE.test(sd)) {
      reasons.push(`sourceDate must be "YYYY-MM-DD", got ${JSON.stringify(sd)}`);
    } else {
      const d = new Date(`${sd}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) reasons.push(`sourceDate is not a valid date: ${sd}`);
      else sourceDate = d;
    }

    if (reasons.length > 0) {
      rejected.push({
        index,
        symbol: symbolRaw || undefined,
        reason: reasons.join("; "),
      });
      continue;
    }

    prepared.push({
      index,
      stockId,
      symbol: symbolRaw,
      metric: metric as BankSupplementaryMetric,
      fiscalYear,
      quarter,
      value: value as number,
      sourceCitation,
      sourceDate: sourceDate as Date,
    });
  }

  // ── ALL-OR-NOTHING: any rejection ⇒ write nothing ──
  if (rejected.length > 0) {
    return {
      ok: false,
      summary: {
        inserted: 0,
        superseded: 0,
        unchanged: 0,
        rejected: rejected.length,
        total: entries.length,
      },
      results: [],
      rejected,
    };
  }

  // ── Apply supersede writes atomically ──
  const results = await prisma.$transaction(async (tx) => {
    const out: AcceptedEntryResult[] = [];
    for (const p of prepared) {
      // Latest existing version for this exact cell. `quarter: null` compiles to
      // `quarter IS NULL`, so annual rows match annual rows only.
      const latest = await tx.bankSupplementary.findFirst({
        where: {
          stockId: p.stockId,
          metric: p.metric,
          fiscalYear: p.fiscalYear,
          quarter: p.quarter,
        },
        orderBy: { version: "desc" },
        select: { id: true, version: true, value: true, sourceCitation: true },
      });

      if (!latest) {
        const row = await tx.bankSupplementary.create({
          data: {
            stockId: p.stockId,
            symbol: p.symbol,
            metric: p.metric,
            fiscalYear: p.fiscalYear,
            quarter: p.quarter,
            value: p.value,
            sourceCitation: p.sourceCitation,
            sourceDate: p.sourceDate,
            version: 1,
            enteredBy: input.enteredBy,
          },
          select: { id: true, version: true },
        });
        out.push(accepted(p, "inserted", row.version, row.id));
        continue;
      }

      const sameValue = latest.value.equals(p.value);
      const sameSource = latest.sourceCitation === p.sourceCitation;
      if (sameValue && sameSource) {
        out.push(accepted(p, "unchanged", latest.version, latest.id));
        continue;
      }

      const row = await tx.bankSupplementary.create({
        data: {
          stockId: p.stockId,
          symbol: p.symbol,
          metric: p.metric,
          fiscalYear: p.fiscalYear,
          quarter: p.quarter,
          value: p.value,
          sourceCitation: p.sourceCitation,
          sourceDate: p.sourceDate,
          version: latest.version + 1,
          supersedesId: latest.id,
          enteredBy: input.enteredBy,
        },
        select: { id: true, version: true },
      });
      out.push(accepted(p, "superseded", row.version, row.id));
    }
    return out;
  });

  const inserted = results.filter((r) => r.action === "inserted").length;
  const superseded = results.filter((r) => r.action === "superseded").length;
  const unchanged = results.filter((r) => r.action === "unchanged").length;

  return {
    ok: true,
    summary: { inserted, superseded, unchanged, rejected: 0, total: entries.length },
    results,
    rejected: [],
  };
}

function accepted(
  p: PreparedEntry,
  action: EntryAction,
  version: number,
  rowId: string,
): AcceptedEntryResult {
  return {
    index: p.index,
    symbol: p.symbol,
    metric: p.metric,
    fiscalYear: p.fiscalYear,
    quarter: p.quarter,
    action,
    version,
    rowId,
  };
}
