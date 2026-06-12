// File: src/ingestions/quaterly-results/ingester-utils.ts (NEW — replaces v2's scattered helpers)

import { Prisma } from "../../generated/prisma/client.js";

/**
 * Convert nullable number to Prisma Decimal-safe value.
 * Rounds to 2 decimal places (Decimal(18,2) precision) by default.
 */
export function safeNumber(
  v: number | null | undefined,
  precision: number = 2,
): Prisma.Decimal | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return new Prisma.Decimal(v.toFixed(precision));
}

export function decimalRatio(
  v: number | null | undefined,
): Prisma.Decimal | null {
  return safeNumber(v, 6);
}

export function decimalPct(
  v: number | null | undefined,
): Prisma.Decimal | null {
  return safeNumber(v, 4);
}

export function decimalPerShare(
  v: number | null | undefined,
): Prisma.Decimal | null {
  return safeNumber(v, 4);
}

/**
 * Compute the prior fiscal-quarter label.
 * Q1 → previous year Q4; Q2 → Q1; Q3 → Q2; Q4 → Q3.
 */
export function getPriorQuarter(
  quarter: string,
  fiscalYear: string,
): { quarter: string; fiscalYear: string } | null {
  switch (quarter) {
    case "Q2":
      return { quarter: "Q1", fiscalYear };
    case "Q3":
      return { quarter: "Q2", fiscalYear };
    case "Q4":
      return { quarter: "Q3", fiscalYear };
    case "Q1":
      return { quarter: "Q4", fiscalYear: decrementFY(fiscalYear) };
    default:
      return null;
  }
}

/**
 * "FY26" → "FY25"
 */
export function decrementFY(fy: string): string {
  const m = fy.match(/^FY(\d{2})$/);
  if (!m) throw new Error(`Invalid FY format: ${fy}`);
  const year = parseInt(m[1], 10);
  const prev = year === 0 ? 99 : year - 1;
  return `FY${String(prev).padStart(2, "0")}`;
}

/**
 * Standard percent change: (new - old) / |old| * 100.
 * Returns null if old is null/zero or new is null.
 */
export function pctChange(
  newVal: number | null | undefined,
  oldVal: number | null | undefined,
): number | null {
  if (newVal === null || newVal === undefined || !Number.isFinite(newVal))
    return null;
  if (oldVal === null || oldVal === undefined || !Number.isFinite(oldVal))
    return null;
  if (oldVal === 0) return null;
  return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
}

/**
 * Sum non-null components. If ALL are null, returns null. Otherwise treats nulls as 0.
 * Use for derived totals where partial data is acceptable.
 */
export function sumNonNull(
  ...vals: (number | null | undefined)[]
): number | null {
  let sawNonNull = false;
  let total = 0;
  for (const v of vals) {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      sawNonNull = true;
      total += v;
    }
  }
  return sawNonNull ? total : null;
}

/**
 * Convert Prisma.Decimal | null → number | null for arithmetic in derive functions.
 */
export function toNumber(d: Prisma.Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  const n = d.toNumber();
  return Number.isFinite(n) ? n : null;
}

/**
 * Round to 2 decimal places without precision.toFixed string roundtrip.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Average of two values, ignoring nulls. Returns null if both null.
 */
export function avgNonNull(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a ?? null;
  return (a + b) / 2;
}
