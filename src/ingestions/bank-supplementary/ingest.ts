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
//
// FIELD ADAPTERS (accept both the API shape and the bulk-extract JSON shape):
//   metric    | metricKey   → stored as metric
//   sourceDate              → "YYYY-MM-DD" (required for found rows)
//   periodEnd               → "DD-Mon-YYYY" → converted to YYYY-MM-DD
//   fiscalYear              → "FY24" | "LIVE" (LIVE = latest live figure)
//
// MISSING-ROW SEMANTICS:
//   status="missing" rows land with value=null, sourceCitation=null,
//   sourceDate=null. They are explicit gaps the scoring engine reads via the
//   §5.8 neutral-60 path. They must NOT be dropped.
//
// FOUND-INVARIANT (enforced here, not by DB):
//   status="found" ⟹ value IS NOT NULL ∧ sourceCitation IS NOT NULL

import { prisma } from "../../db/prisma.js";
import type { BankSupplementaryMetric } from "../../generated/prisma/client.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { CASA_BAND, TIER1_BAND, checkBand } from "../quaterly-results/financial-guards.js";

// ── Public input contract ─────────────────────────────────────────────────────

export interface BankSupplementaryEntryInput {
  symbol: string;
  /** "casa_pct" | "tier1_pct" — also accepted as `metricKey` */
  metric?: string;
  metricKey?: string;
  fiscalYear: string; // "FY24" | "LIVE"
  quarter?: string | null; // "Q1".."Q4"; omit/null for annual
  /** PERCENT e.g. 43.82. NULL for status="missing" rows. */
  value: number | null;
  /** Required for status="found"; null for status="missing". */
  sourceCitation?: string | null;
  /** "YYYY-MM-DD". Required for found rows; can be derived from `periodEnd`. */
  sourceDate?: string | null;
  /** "DD-Mon-YYYY" alternate date field (bulk extract shape). Converted → sourceDate. */
  periodEnd?: string | null;
  /** "A" | "B" | "C" | null */
  confidence?: string | null;
  /** "found" | "missing". Defaults to "found". */
  status?: string | null;
  /** Free-form annotation. */
  notes?: string | null;
}

export interface BankSupplementaryUploadInput {
  enteredBy: string;
  entries: unknown[];
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
  ok: boolean;
  summary: {
    inserted: number;
    superseded: number;
    unchanged: number;
    rejected: number;
    total: number;
  };
  results: AcceptedEntryResult[];
  rejected: RejectedEntry[];
}

// ── Validation constants ──────────────────────────────────────────────────────

const VALID_METRICS = new Set<string>(["casa_pct", "tier1_pct"]);
// "FY" + 2 digits OR the literal "LIVE" (latest live figure)
const FY_RE = /^(FY\d{2}|LIVE)$/;
const QUARTER_RE = /^Q[1-4]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_CONFIDENCE = new Set<string>(["A", "B", "C"]);
const VALID_STATUS = new Set<string>(["found", "missing"]);
const VALUE_MIN = 0;
const VALUE_MAX = 100;

// DD-Mon-YYYY → YYYY-MM-DD (e.g. "31-Mar-2017" → "2017-03-31")
const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parsePeriodEnd(raw: string): string | null {
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTH_MAP[m[2]];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1]}`;
}

// ── Prepared entry (post-validation, ready to write) ─────────────────────────

interface PreparedEntry {
  index: number;
  stockId: string;
  symbol: string;
  metric: BankSupplementaryMetric;
  fiscalYear: string;
  quarter: string | null;
  value: number | null;
  sourceCitation: string | null;
  sourceDate: Date | null;
  confidence: string | null;
  status: string;
  notes: string | null;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function ingestBankSupplementary(
  input: BankSupplementaryUploadInput,
): Promise<BankSupplementaryUploadResult> {
  const rejected: RejectedEntry[] = [];
  const entries = input.entries;

  // Resolve all symbols in one query
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

  // Per-entry validation
  const prepared: PreparedEntry[] = [];

  for (let index = 0; index < entries.length; index++) {
    const e = entries[index] as Record<string, unknown> | null;
    const reasons: string[] = [];

    if (!e || typeof e !== "object") {
      rejected.push({ index, reason: "entry is not an object" });
      continue;
    }

    // symbol → existing Stock with industryType "banking"
    const symbolRaw = typeof e.symbol === "string" ? e.symbol.trim().toUpperCase() : "";
    let stockId = "";
    if (!symbolRaw) {
      reasons.push("symbol is required");
    } else {
      const stock = stockBySymbol.get(symbolRaw);
      if (!stock) {
        reasons.push(`unknown symbol "${symbolRaw}" (no such Stock)`);
      } else if (stock.industryType !== "banking") {
        reasons.push(
          `symbol "${symbolRaw}" is not a bank (industryType=${stock.industryType})`,
        );
      } else {
        stockId = stock.id;
      }
    }

    // metric — accept `metric` or `metricKey` (bulk-extract shape)
    const metricRaw =
      typeof e.metric === "string"
        ? e.metric
        : typeof e.metricKey === "string"
          ? e.metricKey
          : "";
    if (!VALID_METRICS.has(metricRaw)) {
      reasons.push(
        `metric/metricKey must be one of [${[...VALID_METRICS].join(", ")}], got ${JSON.stringify(e.metric ?? e.metricKey)}`,
      );
    }

    // fiscalYear — "FYxx" or "LIVE"
    const fiscalYear = typeof e.fiscalYear === "string" ? e.fiscalYear.trim() : "";
    if (!FY_RE.test(fiscalYear)) {
      reasons.push(
        `fiscalYear must match /^(FY\\d{2}|LIVE)$/, got ${JSON.stringify(e.fiscalYear)}`,
      );
    }

    // quarter — optional; null/omitted = annual
    let quarter: string | null = null;
    if (e.quarter !== undefined && e.quarter !== null) {
      if (typeof e.quarter === "string" && QUARTER_RE.test(e.quarter)) {
        quarter = e.quarter;
      } else {
        reasons.push(
          `quarter must be Q1..Q4 or null/omitted, got ${JSON.stringify(e.quarter)}`,
        );
      }
    }

    // status — default "found"
    const statusRaw =
      e.status === null || e.status === undefined
        ? "found"
        : typeof e.status === "string"
          ? e.status
          : "";
    if (!VALID_STATUS.has(statusRaw)) {
      reasons.push(`status must be "found" or "missing", got ${JSON.stringify(e.status)}`);
    }
    const isMissing = statusRaw === "missing";

    // value — null allowed only for missing rows
    let value: number | null = null;
    if (e.value === null || e.value === undefined) {
      if (!isMissing) {
        reasons.push(`value is required for status="found"`);
      }
    } else if (typeof e.value !== "number" || Number.isNaN(e.value)) {
      reasons.push(`value must be a number (percent), got ${JSON.stringify(e.value)}`);
    } else if (e.value < VALUE_MIN || e.value > VALUE_MAX) {
      reasons.push(`value ${e.value} out of range [${VALUE_MIN}, ${VALUE_MAX}] (percent)`);
    } else {
      value = e.value;
    }

    // sourceCitation — required for found, null for missing
    let sourceCitation: string | null = null;
    if (!isMissing) {
      const sc = typeof e.sourceCitation === "string" ? e.sourceCitation.trim() : "";
      if (!sc) {
        reasons.push(`sourceCitation is required and must be non-empty for status="found"`);
      } else {
        sourceCitation = sc;
      }
    }
    // for missing rows: sourceCitation stays null regardless of what the entry has

    // sourceDate — resolve from sourceDate or periodEnd; required for found rows only
    let sourceDate: Date | null = null;
    if (!isMissing) {
      let sdStr: string | null = null;
      if (typeof e.sourceDate === "string" && DATE_RE.test(e.sourceDate)) {
        sdStr = e.sourceDate;
      } else if (typeof e.periodEnd === "string") {
        sdStr = parsePeriodEnd(e.periodEnd);
      }
      if (!sdStr) {
        reasons.push(
          `sourceDate (YYYY-MM-DD) or periodEnd (DD-Mon-YYYY) required for status="found"`,
        );
      } else {
        const d = new Date(`${sdStr}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) {
          reasons.push(`sourceDate is not a valid date: ${sdStr}`);
        } else {
          sourceDate = d;
        }
      }
    }

    // confidence — A/B/C or null
    let confidence: string | null = null;
    if (e.confidence !== null && e.confidence !== undefined) {
      if (typeof e.confidence === "string" && VALID_CONFIDENCE.has(e.confidence)) {
        confidence = e.confidence;
      } else {
        reasons.push(
          `confidence must be "A", "B", "C", or null/omitted, got ${JSON.stringify(e.confidence)}`,
        );
      }
    }

    // notes — free text; null/empty both fine
    const notes =
      typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null;

    if (reasons.length > 0) {
      rejected.push({ index, symbol: symbolRaw || undefined, reason: reasons.join("; ") });
      continue;
    }

    prepared.push({
      index,
      stockId,
      symbol: symbolRaw,
      metric: metricRaw as BankSupplementaryMetric,
      fiscalYear,
      quarter,
      value,
      sourceCitation,
      sourceDate,
      confidence,
      status: statusRaw,
      notes,
    });
  }

  // ALL-OR-NOTHING: any rejection ⇒ write nothing
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

  // Apply supersede writes atomically. 264 entries × 2 queries each can exceed
  // the default 5s interactive-tx timeout when routed via a connection pooler
  // (Supabase PgBouncer adds latency per query). 60s covers the worst case.
  const results = await prisma.$transaction(async (tx) => {
    const out: AcceptedEntryResult[] = [];

    for (const p of prepared) {
      const latest = await tx.bankSupplementary.findFirst({
        where: {
          stockId: p.stockId,
          metric: p.metric,
          fiscalYear: p.fiscalYear,
          quarter: p.quarter,
        },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          value: true,
          sourceCitation: true,
          status: true,
        },
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
            confidence: p.confidence,
            status: p.status,
            notes: p.notes,
            version: 1,
            enteredBy: input.enteredBy,
          },
          select: { id: true, version: true },
        });
        out.push(accepted(p, "inserted", row.version, row.id));
        continue;
      }

      // Equality check: both null → same; else Decimal.equals for values
      const sameValue =
        p.value === null && latest.value === null
          ? true
          : p.value !== null && latest.value !== null
            ? latest.value.equals(p.value)
            : false;
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
          confidence: p.confidence,
          status: p.status,
          notes: p.notes,
          version: latest.version + 1,
          supersedesId: latest.id,
          enteredBy: input.enteredBy,
        },
        select: { id: true, version: true },
      });
      out.push(accepted(p, "superseded", row.version, row.id));
    }

    return out;
  }, { timeout: 60_000 });

  // ── Band-check guard (CASA [15,60] / Tier-1 [5,25]) ──
  // The write itself only enforces [0,100]; the admin page enforces the
  // tighter band. This RECORDS a band violation to the error table so a
  // seed/batch path that bypasses the page (or a repeated fat-finger) leaves
  // a signal. Value lands (medium); an admin can re-enter the right figure.
  for (const p of prepared) {
    if (p.status !== "found" || p.value === null) continue;
    const band = p.metric === "casa_pct" ? CASA_BAND : TIER1_BAND;
    if (!checkBand(p.value, band)) continue;
    await reportIngestionError({
      source: "admin_manual",
      cron: "bank_supplementary",
      guardType: "range",
      targetTable: "BankSupplementary",
      targetField: p.metric,
      targetEntity: `${p.symbol}@${p.fiscalYear}${p.quarter ? `-${p.quarter}` : ""}`,
      severity: "medium",
      resolutionPath: "admin_fill",
      expected: `${p.metric} in [${band[0]}, ${band[1]}]%`,
      observed: `${p.value}%`,
      detail: "Bank supplementary value outside its plausible band — likely a hand-entry error (e.g. 4.5 vs 45).",
      runRef: `banksupp:${input.enteredBy}`,
    });
  }

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
