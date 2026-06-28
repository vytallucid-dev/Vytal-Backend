// ─────────────────────────────────────────────────────────────
// ERROR-RESOLUTION helpers for the resolution UI.
//   • resolveErrorRowId — parse an IngestionError's targetEntity (+ runRef) into
//     the concrete DB row id the fill edits (per-table natural-key lookup).
//   • fillMetaFor — per-(table,field) editor metadata (type/unit/bounds) for the modal.
//   • annotateFill — the per-row {fill, reFetchAvailable} the list endpoint adds.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { FILLABLE } from "./raw-field-edit.js";

const FUND_ANNUAL = new Set([
  "Fundamental", "BankingFundamental", "NbfcFundamental",
  "LifeInsuranceFundamental", "GeneralInsuranceFundamental",
]);
const FUND_QUARTERLY = new Set([
  "QuarterlyResult", "BankingQuarterlyResult", "NbfcQuarterlyResult",
  "LifeInsuranceQuarterlyResult", "GeneralInsuranceQuarterlyResult",
]);
/** Tables whose fill bridge supports a re-fetch action (a re-ingestable feed). */
export const REFETCH_TABLES = new Set(["DailyPrice"]);

const modelKey = (table: string) => table.charAt(0).toLowerCase() + table.slice(1);

/**
 * Resolve an IngestionError's targetEntity → the concrete row id to edit. Returns
 * null when the entity can't be parsed/found (e.g. a batch-level shape/count row
 * with no targetEntity, or a table the bridge doesn't cover).
 */
export async function resolveErrorRowId(
  table: string,
  targetEntity: string | null,
  runRef: string | null,
): Promise<string | null> {
  if (!FILLABLE[table]) return null;

  // Fundamentals: entity = "stockId@FY24@standalone" (annual) | "stockId@Q2-FY24@standalone" (quarterly)
  if (FUND_ANNUAL.has(table)) {
    if (!targetEntity) return null;
    const [stockId, fiscalYear, resultType] = targetEntity.split("@");
    if (!stockId || !fiscalYear || !resultType) return null;
    const model = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<{ id: string } | null> }>)[modelKey(table)];
    const row = await model.findUnique({ where: { stockId_fiscalYear_resultType: { stockId, fiscalYear, resultType } }, select: { id: true } });
    return row?.id ?? null;
  }
  if (FUND_QUARTERLY.has(table)) {
    if (!targetEntity) return null;
    const [stockId, qfy, resultType] = targetEntity.split("@");
    const [quarter, fiscalYear] = (qfy ?? "").split("-");
    if (!stockId || !quarter || !fiscalYear || !resultType) return null;
    const model = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<{ id: string } | null> }>)[modelKey(table)];
    const row = await model.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId, quarter, fiscalYear, resultType } }, select: { id: true } });
    return row?.id ?? null;
  }
  if (table === "ShareholdingPattern") {
    if (!targetEntity) return null;
    const [symbol, asOn] = targetEntity.split("@");
    if (!symbol || !asOn) return null;
    const row = await prisma.shareholdingPattern.findFirst({ where: { symbol, asOnDate: new Date(asOn) }, select: { id: true } });
    return row?.id ?? null;
  }
  if (table === "CorporateEvent") {
    if (!targetEntity) return null;
    const [symbol, eventType, eventDate] = targetEntity.split("@");
    if (!symbol || !eventType || !eventDate) return null;
    const row = await prisma.corporateEvent.findFirst({ where: { symbol, eventType, eventDate: new Date(eventDate) }, select: { id: true } });
    return row?.id ?? null;
  }
  if (table === "DailyPrice") {
    // entity = symbol; the trading date lives in runRef = "YYYY-MM-DD:provider".
    const symbol = targetEntity ?? "";
    const dateIso = runRef?.split(":")[0];
    if (!symbol || !dateIso) return null;
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
    if (!stock) return null;
    const row = await prisma.dailyPrice.findUnique({ where: { stockId_date: { stockId: stock.id, date: new Date(dateIso) } }, select: { id: true } });
    return row?.id ?? null;
  }
  return null;
}

export interface FillMeta {
  type: "number";
  unit: string;
  bounds: { min?: number; max?: number } | null;
}

/** Editor metadata for a (table, field) — drives the modal's input + validation. */
export function fillMetaFor(table: string, field: string): FillMeta {
  if (table === "ShareholdingPattern") return { type: "number", unit: "%", bounds: { min: 0, max: 100 } };
  if (table === "DailyPrice") return { type: "number", unit: field === "tradedValue" ? "₹ Cr" : "₹", bounds: { min: 0.01 } };
  if (table === "CorporateEvent") return { type: "number", unit: "₹/share", bounds: { min: 0 } };
  // fundamentals: ratios/% vs per-share vs ₹Cr line items
  if (/pct$|ratio$|margin$|roe$|roce$|nim$|spread$|solvency|persistency|coverage$|turnover$/i.test(field)) {
    return { type: "number", unit: /margin|pct|roe|roce|growth|nim/i.test(field) ? "%" : "ratio", bounds: null };
  }
  if (/eps$|faceValue|bookValue|perShare/i.test(field)) return { type: "number", unit: "₹/share", bounds: null };
  return { type: "number", unit: "₹ Cr", bounds: field === "revenue" ? { min: 0 } : null };
}

export interface FillAnnotation {
  fillable: boolean;
  table: string;
  /** All RAW-fillable columns for this table (so the modal offers a field-picker
   *  when the flagged targetField is generic, e.g. shareholding "pct"). */
  fields: string[];
  /** The flagged field (may be generic or null for batch-level rows). */
  flaggedField: string | null;
  /** Editor meta for the flagged field (or the first fillable field as default). */
  meta: FillMeta;
  /** The row's `expected` text — the precise bound hint for the admin. */
  expectedHint: string;
}

/**
 * Per-row UI annotation for the list endpoint: whether/how the row is fillable
 * and whether a re-fetch action is offered. Pure (no DB) — entity-resolvability
 * is checked at fill time.
 */
export function annotateFill(row: {
  targetTable: string; targetField: string | null; targetEntity: string | null;
  resolutionPath: string; expected: string;
}): { fill: FillAnnotation | null; reFetchAvailable: boolean } {
  const fields = FILLABLE[row.targetTable];
  const reFetchAvailable = REFETCH_TABLES.has(row.targetTable) && !!row.targetEntity;
  if (!fields) return { fill: null, reFetchAvailable };

  // Fillable when: admin_fill + the table is in the bridge + we have an entity to
  // resolve. The specific field may be generic ("pct") → the modal picks from `fields`.
  const fieldList = [...fields];
  const flaggedFillable = row.targetField != null && fields.has(row.targetField);
  const fillable = row.resolutionPath === "admin_fill" && !!row.targetEntity && (flaggedFillable || fieldList.length > 0);
  const defaultField = flaggedFillable ? row.targetField! : fieldList[0];
  return {
    fill: {
      fillable,
      table: row.targetTable,
      fields: fieldList,
      flaggedField: row.targetField ?? null,
      meta: fillMetaFor(row.targetTable, defaultField),
      expectedHint: row.expected,
    },
    reFetchAvailable,
  };
}
