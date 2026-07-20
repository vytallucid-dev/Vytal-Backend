// ─────────────────────────────────────────────────────────────────────────────
// PER-SCHEME SPLIT LOAD — the reconciled splits behind one amfi_scheme_code.
//
// The fold loads splits for the WHOLE universe in one bulk query; its two siblings — the live
// /chart endpoint and the Step-21 weekly store — each need them for ONE scheme. This is that one
// per-scheme query, shared, so there is a single shape. (All 63 real splits are ETFs; a mutual fund
// scheme returns [].) The RULE that consumes these lives in mf-split-adjust.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { dayOf, type SplitEvent } from "./mf-split-adjust.js";

/** Reconciled splits (split_factor + applied_date present) for the instrument behind a scheme code. */
export async function loadSplitsForScheme(schemeCode: string): Promise<SplitEvent[]> {
  const rows = await prisma.$queryRawUnsafe<{ applied_date: Date; split_factor: unknown }[]>(
    `SELECT e.applied_date, e.split_factor
       FROM instrument_corporate_events e JOIN instruments i ON i.id = e.instrument_id
      WHERE i.amfi_scheme_code = $1 AND e.event_type = 'split'
        AND e.split_factor IS NOT NULL AND e.split_factor > 0 AND e.applied_date IS NOT NULL`,
    schemeCode,
  );
  return rows.map((r) => ({
    appliedDay: dayOf(r.applied_date.toISOString().slice(0, 10)),
    factor: Number(r.split_factor),
  }));
}
