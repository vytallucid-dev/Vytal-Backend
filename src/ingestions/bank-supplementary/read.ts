// File: src/ingestions/bank-supplementary/read.ts
//
// Storage-layer read for manually-entered supplementary banking figures.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCORING BOUNDARY — READ THIS BEFORE EDITING.
//
// This function returns VALUE-OR-ABSENT only. It performs NO scoring logic.
// In particular it MUST NOT apply the "neutral-hold 60" fallback (or any other
// score/band/weight transform). An ABSENT result means literally "no figure on
// file" — nothing more. The Phase-3 banking-Foundation scorer (F7 / Tier-1) is
// the ONLY place allowed to decide what absence means (e.g. neutral-hold).
// Keep this layer dumb so the scoring policy lives in exactly one place.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import type { BankSupplementaryMetric } from "../../generated/prisma/client.js";

export type BankSupplementaryReadResult =
  | {
      present: true;
      value: number; // PERCENT (e.g. 43.82), latest version's figure
      sourceCitation: string;
      sourceDate: Date;
      version: number;
    }
  | { present: false };

/**
 * Return the LATEST version's figure for one (stock, metric, fiscalYear, quarter)
 * cell, or `{ present: false }` if no row exists.
 *
 * @param quarter omit / null / undefined for an ANNUAL figure.
 */
export async function getBankSupplementary(
  stockId: string,
  metric: BankSupplementaryMetric,
  fiscalYear: string,
  quarter?: string | null,
): Promise<BankSupplementaryReadResult> {
  const row = await prisma.bankSupplementary.findFirst({
    where: {
      stockId,
      metric,
      fiscalYear,
      quarter: quarter ?? null, // null ⇒ matches the annual row (quarter IS NULL)
    },
    orderBy: { version: "desc" }, // newest version wins
    select: { value: true, sourceCitation: true, sourceDate: true, version: true },
  });

  if (!row) return { present: false };

  return {
    present: true,
    value: row.value.toNumber(),
    sourceCitation: row.sourceCitation,
    sourceDate: row.sourceDate,
    version: row.version,
  };
}
